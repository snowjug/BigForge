import { containsSecret } from '@bigforge/security';
import type { VerificationReport, VerificationRuleResult } from '@bigforge/schemas';
import { diffManifests, type InstrumentedTools } from '@bigforge/core';
import {
  type LogError,
  type WorkspaceGraph,
  locateRoot,
  parseBuildLog,
  parseGraph,
} from './logparse';

export interface Snapshot {
  hashes: Record<string, string>;
  texts: Record<string, string>;
}

export interface VerifyInput {
  rebuild: { ok: boolean; text: string };
  tests: { ok: boolean; text: string };
  originalErrors: LogError[];
  /** Root-cause workspace, determined independently from the original log and dependency graph. */
  rootWorkspace: string;
  before: Snapshot;
  after: Snapshot;
}

const PROTECTED = [/^forge\.lock\.json$/, /^\.github\//, /^ci\//, /(^|\/)\.env(\.|$)/];

export const VERIFICATION_LABELS = {
  original_failure_gone: 'The original failure no longer reproduces',
  relevant_tests_pass: 'Relevant tests pass',
  no_unrelated_changes: 'No unrelated files changed',
  security_policy_pass: 'Security policy passes',
} as const;

function lastLines(text: string, n = 1): string {
  return text.trim().split('\n').slice(-n).join(' ').slice(0, 200);
}

function parseJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null;
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** Objective completion evidence from explicit checks (never from an agent's claim). */
export function evaluateRules(input: VerifyInput, verifiedAt: string): VerificationReport {
  const rules: VerificationRuleResult[] = [];

  const stillThere = input.originalErrors.filter((e) =>
    input.rebuild.text.includes(`error ${e.code}: ${e.message}`),
  );
  rules.push({
    id: 'original_failure_gone',
    label: VERIFICATION_LABELS.original_failure_gone,
    status: input.rebuild.ok && stillThere.length === 0 ? 'pass' : 'fail',
    evidence: input.rebuild.ok
      ? `forge-ci build exited 0; none of the ${input.originalErrors.length} original error(s) remain`
      : `forge-ci build still fails: ${lastLines(input.rebuild.text)}`,
  });

  rules.push({
    id: 'relevant_tests_pass',
    label: VERIFICATION_LABELS.relevant_tests_pass,
    status: input.tests.ok ? 'pass' : 'fail',
    evidence: lastLines(input.tests.text) || 'no test output',
  });

  const diff = diffManifests(input.before.hashes, input.after.hashes);
  const changed = [...diff.added, ...diff.removed, ...diff.modified];
  const unrelated = changed.filter((f) => !f.startsWith(`${input.rootWorkspace}/`));
  rules.push({
    id: 'no_unrelated_changes',
    label: VERIFICATION_LABELS.no_unrelated_changes,
    status: changed.length > 0 && unrelated.length === 0 ? 'pass' : 'fail',
    evidence:
      changed.length === 0
        ? 'No files changed, so the failure cannot have been repaired'
        : unrelated.length === 0
          ? `Changed only ${changed.join(', ')} (inside ${input.rootWorkspace})`
          : `Changed files outside ${input.rootWorkspace}: ${unrelated.join(', ')}`,
  });

  const violations: string[] = [];
  for (const file of changed) {
    if (PROTECTED.some((re) => re.test(file))) violations.push(`${file} is protected`);
    const after = input.after.texts[file];
    if (after && containsSecret(after) && !containsSecret(input.before.texts[file] ?? ''))
      violations.push(`${file} gained a secret`);
    if (file.endsWith('package.json')) {
      const b = parseJson(input.before.texts[file]);
      const a = parseJson(after);
      if (b && a) {
        if (JSON.stringify(b.scripts ?? null) !== JSON.stringify(a.scripts ?? null))
          violations.push(`${file} scripts changed`);
        const catalog = (parseJson(input.after.texts['forge.lock.json'])?.catalog ?? {}) as Record<
          string,
          string
        >;
        const bDeps = (b.dependencies ?? {}) as Record<string, string>;
        const aDeps = (a.dependencies ?? {}) as Record<string, string>;
        for (const dep of Object.keys(aDeps)) {
          if (!Object.hasOwn(bDeps, dep) && !dep.startsWith('@acme/') && !Object.hasOwn(catalog, dep))
            violations.push(`${file} added unpinned dependency ${dep}`);
        }
      }
    }
  }
  rules.push({
    id: 'security_policy_pass',
    label: VERIFICATION_LABELS.security_policy_pass,
    status: violations.length === 0 ? 'pass' : 'fail',
    evidence:
      violations.length === 0
        ? 'No protected paths, scripts, secrets or unpinned dependencies changed'
        : violations.join('; '),
  });

  const status = rules.every((r) => r.status === 'pass') ? 'pass' : 'fail';
  return { verifier: 'bigforge.verifier/1', status, rules, verifiedAt };
}

/**
 * Independent verification: runs its own build and tests and compares file manifests.
 * Used by the platform for every run, whichever agent produced it.
 */
export async function verifyRepository(args: {
  tools: InstrumentedTools;
  before: Snapshot;
  originalLog: string;
  verifiedAt: string;
}): Promise<VerificationReport> {
  const { tools } = args;
  const graphRun = await tools.run(
    { program: 'forge-ci', args: ['graph', '--json'] },
    'verification',
  );
  const graph: WorkspaceGraph | null = graphRun.ok
    ? parseGraph(graphRun.output.split('\n[stderr]')[0] ?? '')
    : null;
  const originalErrors = parseBuildLog(args.originalLog).errors;
  const root = locateRoot(originalErrors, graph, 'dependency_graph');
  const rebuild = await tools.run({ program: 'forge-ci', args: ['build'] }, 'verification');
  const tests = await tools.run({ program: 'forge-ci', args: ['test'] }, 'verification');
  const after = await tools.sandbox.snapshotFiles();
  return evaluateRules(
    {
      rebuild: { ok: rebuild.ok, text: rebuild.output },
      tests: { ok: tests.ok, text: tests.output },
      originalErrors,
      rootWorkspace: root?.workspace ?? '(unknown)',
      before: args.before,
      after,
    },
    args.verifiedAt,
  );
}
