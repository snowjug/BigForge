import { BOUNDARY_POLICY_ID, asText } from '@bigforge/core';
import type {
  ChatMessage,
  CompletionRequest,
  DeterministicPolicy,
  PolicyTurn,
} from '@bigforge/providers';
import { type LogError, locateRoot, parseBuildLog, parseGraph } from './logparse';
import {
  type FileMap,
  type SemanticOption,
  analyseRemedy,
  callArguments,
  nextFileNeeded,
  semanticChoice,
} from './remedy';

export const MONOREPO_AGENT_POLICY_ID = 'monorepo.agent';

interface Observation {
  name: string;
  args: Record<string, unknown>;
  output: string;
}

function observationsOf(messages: ChatMessage[]): Observation[] {
  const out: Observation[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant' || !m.toolCalls) continue;
    for (const call of m.toolCalls) {
      const tool = messages.find((x) => x.role === 'tool' && x.toolCallId === call.id);
      if (tool) out.push({ name: call.name, args: call.args, output: tool.content });
    }
  }
  return out;
}

const stripExit = (s: string) => s.replace(/\n\[exit [^\]]*\]\s*$/, '');
const isError = (s: string) => s.startsWith('BLOCKED') || s.startsWith('ERROR');

function decisionTag(intent: string, body: unknown): string {
  return `<decision intent="${intent}">${JSON.stringify(body)}</decision>`;
}

/**
 * Scripted stand-in for a build-repair model. It reads the observations in the conversation
 * (it never sees hidden scenario data) and behaves like a careful conventional agent:
 * read the log, check the dependency graph, locate the root cause, inspect, decide, patch, verify.
 * Deterministic: the same conversation always yields the same next turn.
 */
export function monorepoAgentPolicy(): DeterministicPolicy {
  return {
    id: MONOREPO_AGENT_POLICY_ID,
    respond(req: CompletionRequest): PolicyTurn {
      const obs = observationsOf(req.messages);
      const callId = `call_${obs.length + 1}`;
      const act = (
        purpose: string,
        text: string,
        name: string,
        args: Record<string, unknown>,
      ): PolicyTurn => ({
        purpose,
        text,
        toolCalls: [{ id: callId, name, args }],
      });
      const files: FileMap = {};
      for (const o of obs)
        if (o.name === 'read_file' && !isError(o.output)) files[asText(o.args.path)] = o.output;

      const logText = files['ci/last-build.log'];
      if (logText === undefined) {
        return act(
          'read_failure_log',
          'The build is red. I will start with the CI failure log to see what broke and in what order.',
          'read_file',
          { path: 'ci/last-build.log' },
        );
      }
      const parsed = parseBuildLog(logText);
      const graphObs = obs.find(
        (o) => o.name === 'run_command' && o.args.command === 'forge-ci graph --json',
      );
      if (!graphObs) {
        return act(
          'inspect_workspace_graph',
          `The log shows ${parsed.errors.length} errors across ${parsed.failedWorkspaces.length} failed workspaces. Several failures may only be consequences of one underlying problem, so I will check the workspace dependency graph before deciding where to look.`,
          'run_command',
          { command: 'forge-ci graph --json' },
        );
      }
      let graph;
      try {
        graph = parseGraph(stripExit(graphObs.output));
      } catch {
        return finishTurn(
          callId,
          'I could not read the workspace graph, so I cannot safely continue.',
          null,
          null,
        );
      }
      const root: LogError | null = locateRoot(parsed.errors, graph, 'dependency_graph');
      if (!root)
        return finishTurn(
          callId,
          'The build log contains no errors, so there is nothing to repair.',
          null,
          null,
        );

      const manifest = `${root.workspace}/package.json`;
      if (files[manifest] === undefined) {
        const cascades = parsed.errors.filter((e) => e.workspace !== root.workspace).length;
        return act(
          'inspect_failing_workspace',
          `Only ${root.workspace} fails without a failing dependency; the ${cascades} other error(s) are consequences of it. The root error is ${root.code}: ${root.message} I will open its manifest.\n${decisionTag('locate_root_cause', { workspace: root.workspace, code: root.code, message: root.message, file: root.file, line: root.line })}`,
          'read_file',
          { path: manifest },
        );
      }
      if (
        !obs.some((o) => o.name === 'run_command' && asText(o.args.command).includes('--verbose'))
      ) {
        return act(
          'run_focused_diagnostic',
          `I will build just ${root.workspace} with verbose resolution output to confirm how the failing import is resolved.`,
          'run_command',
          {
            command: `forge-ci build --workspace ${root.workspace} --verbose`,
          },
        );
      }
      if (
        root.workspace === 'packages/telemetry' &&
        !obs.some((o) => o.name === 'run_command' && asText(o.args.command).startsWith('rm '))
      ) {
        return act(
          'clean_install_attempt',
          'The diagnostic is not conclusive. Perhaps the install state is stale; a clean reinstall may help.',
          'run_command',
          {
            command: 'rm -rf node_modules && npm ci',
          },
        );
      }

      const need = nextFileNeeded(root, files, graph);
      if (need) {
        return act(need.purpose, `I need ${need.path} to decide on the remedy.`, 'read_file', {
          path: need.path,
        });
      }

      if (!obs.some((o) => o.name === 'apply_patch')) {
        const analysis = analyseRemedy(root, files, graph);
        if (analysis.candidates.length === 0) {
          return finishTurn(
            callId,
            `I cannot find a safe remedy for ${root.code} in ${root.workspace}: ${analysis.summary}.`,
            root,
            null,
          );
        }
        let chosen = analysis.candidates[0];
        let why = analysis.summary;
        if (analysis.confidence < 0.8) {
          const requested = /exported member '([^']+)'/.exec(root.message)?.[1] ?? '';
          const callText = analysis.evidence.find((e) => e.tags.includes('call_site'))?.text ?? '';
          const options: SemanticOption[] = analysis.candidates.map((c) => {
            const ev = analysis.evidence.find((e) => e.source === `export:${c.id}`)?.text ?? '';
            const lines = ev.split('\n');
            return {
              id: c.id,
              signature: lines[lines.length - 1] ?? '',
              doc: lines.slice(0, -1).join(' '),
            };
          });
          const pick = semanticChoice(callArguments(callText, requested), options);
          if (pick) {
            chosen = analysis.candidates.find((c) => c.id === pick.choiceId) ?? chosen;
            why = `Several exports look similar by name (${analysis.candidates.map((c) => c.id).join(', ')}). ${pick.rationale}`;
          }
        }
        if (!chosen) return finishTurn(callId, 'No candidate remedy remained.', root, null);
        const { patch, kind, description } = chosen.payload;
        return act(
          'apply_remedy',
          `${why} I will apply the smallest change: ${description}.\n${decisionTag('decide_remedy', { kind, file: patch.file, edits: patch.edits })}`,
          'apply_patch',
          { file: patch.file, edits: patch.edits },
        );
      }
      if (!obs.some((o) => o.name === 'run_command' && o.args.command === 'forge-ci build')) {
        return act(
          'verify_build',
          'The patch is applied. I will rebuild the whole monorepo to confirm the original failure and its cascade are gone.',
          'run_command',
          { command: 'forge-ci build' },
        );
      }
      if (
        !obs.some(
          (o) => o.name === 'run_command' && asText(o.args.command).startsWith('forge-ci test'),
        )
      ) {
        return act(
          'verify_tests',
          `The build result is in. I will run the tests of ${root.workspace} as well.`,
          'run_command',
          {
            command: `forge-ci test --workspace ${root.workspace}`,
          },
        );
      }
      const patchedFile = asText(obs.find((o) => o.name === 'apply_patch')?.args.file);
      return finishTurn(
        callId,
        `Repaired ${root.workspace}: ${root.code}. Patched ${patchedFile}, rebuilt and ran the tests.`,
        root,
        { kind: 'applied', summary: `Patched ${patchedFile}` },
      );
    },
  };
}

function finishTurn(
  callId: string,
  summary: string,
  root: LogError | null,
  remedy: { kind: string; summary: string } | null,
): PolicyTurn {
  return {
    purpose: 'report',
    text: summary,
    toolCalls: [
      {
        id: callId,
        name: 'finish',
        args: {
          summary,
          root_failure: root
            ? {
                workspace: root.workspace,
                code: root.code,
                message: root.message,
                file: root.file,
                line: root.line,
              }
            : null,
          remedy,
        },
      },
    ],
  };
}

interface Chunk {
  id: string;
  source: string;
  body: string;
}

function parseChunks(user: string): Chunk[] {
  const parts = user.split(/^### (\S+) \((.*)\)$/m);
  const chunks: Chunk[] = [];
  for (let i = 1; i + 2 < parts.length + 1; i += 3) {
    chunks.push({
      id: parts[i] as string,
      source: parts[i + 1] as string,
      body: (parts[i + 2] ?? '').trim(),
    });
  }
  return chunks;
}

/**
 * Scripted stand-in for the model consulted at an uncertainty boundary. It sees ONLY the
 * firewall-selected prompt (question, options, minimal evidence), so if the firewall withheld
 * something needed, it cannot answer well.
 */
export function boundaryChoicePolicy(): DeterministicPolicy {
  return {
    id: BOUNDARY_POLICY_ID,
    respond(req: CompletionRequest): PolicyTurn {
      const user = req.messages.find((m) => m.role === 'user')?.content ?? '';
      const options = [...user.matchAll(/^- ([^:\n]+): (.*?) \| (.*)$/gm)].map((m) => ({
        id: (m[1] as string).trim(),
        label: m[2] as string,
      }));
      const chunks = parseChunks(user);
      const error = chunks.find((c) => c.source.startsWith('error:'))?.body ?? '';
      const requested = /exported member '([^']+)'/.exec(error)?.[1] ?? '';
      const callSite = chunks.find((c) => c.source.startsWith('call-site:'))?.body ?? '';
      const sem: SemanticOption[] = options.map((o) => {
        const body = chunks.find((c) => c.source === `export:${o.id}`)?.body ?? '';
        const lines = body.split('\n');
        return {
          id: o.id,
          signature: lines[lines.length - 1] ?? '',
          doc: lines.slice(0, -1).join(' '),
        };
      });
      const pick =
        requested && callSite ? semanticChoice(callArguments(callSite, requested), sem) : null;
      const answer = pick ?? {
        choiceId: options[0]?.id ?? '',
        rationale: 'The evidence provided was not sufficient to distinguish the options.',
        confidence: 0.3,
      };
      return { text: JSON.stringify(answer) };
    },
  };
}

export function monorepoPolicies(): DeterministicPolicy[] {
  return [monorepoAgentPolicy(), boundaryChoicePolicy()];
}
