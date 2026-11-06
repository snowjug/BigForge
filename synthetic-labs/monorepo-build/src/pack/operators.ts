import {
  asText,
  type OperatorDefinition,
  type OperatorResult,
  type RecordedBehaviour,
  OperatorLibrary,
} from '@bigforge/core';
import type { BoundarySpec } from '@bigforge/schemas';
import { evaluateRules, type Snapshot } from './verifier';
import {
  type GraphWorkspace,
  type LogError,
  type ParsedLog,
  type RootLocator,
  type WorkspaceGraph,
  locateRoot,
  normalizeLog,
  parseBuildLog,
  parseGraph,
  workspaceByPath,
} from './logparse';
import { type Candidate, type FileMap, type Remedy, analyseRemedy, nextFileNeeded } from './remedy';

const str = (v: unknown, what: string): string => {
  if (typeof v !== 'string' || v.length === 0)
    throw new Error(`Expected ${what} to be a non-empty string`);
  return v;
};

function rec<T>(v: unknown, what: string): T {
  if (v === null || typeof v !== 'object') throw new Error(`Expected ${what} to be an object`);
  return v as T;
}

const NO_PERMS = { read: [] as string[], write: [] as string[], commands: [] as string[] };

interface NormalizedLog {
  text: string;
  errors: LogError[];
  failedWorkspaces: string[];
  mode: ParsedLog['mode'];
  toolchain: ParsedLog['toolchain'];
}

interface RootFailureData {
  workspace: string;
  code: string;
  message: string;
  file: string | null;
  line: number | null;
  col: number | null;
  index: number;
}

const toolCommand = (rec_: RecordedBehaviour, command: string): boolean =>
  rec_.toolCalls.some((t) => t.tool === 'run_command' && t.args.command === command);

const sameRoot = (rb: RecordedBehaviour, produced: OperatorResult) => {
  const decision = rb.decisions.find((d) => d.intent === 'locate_root_cause');
  const recorded = decision?.output as { workspace?: string; code?: string } | undefined;
  const got = (produced.output.root_failure ?? {}) as Partial<RootFailureData>;
  const ok = !!recorded && recorded.workspace === got.workspace && recorded.code === got.code;
  return {
    ok,
    detail: ok
      ? `identified ${got.code} in ${got.workspace}, as the baseline did`
      : `produced ${got.code ?? '?'} in ${got.workspace ?? '?'} but the baseline identified ${recorded?.code ?? '?'} in ${recorded?.workspace ?? '?'}`,
  };
};

const locateOperator = (how: RootLocator): OperatorDefinition => ({
  id: how === 'log_order' ? 'local.locate_by_log_order' : 'local.locate_by_dependency_graph',
  version: '1.0.0',
  stepId: 'locate',
  intent: 'locate_root_cause',
  title:
    how === 'log_order'
      ? 'Locate first causal error (log order)'
      : 'Locate root cause (dependency graph)',
  description:
    how === 'log_order'
      ? 'Takes the first error line in the build log as the root cause. Cheap; assumes the log lists a workspace failure before the failures it causes.'
      : 'Takes an error in a workspace none of whose dependencies also failed. Independent of log ordering; needs the workspace graph.',
  kind: 'known',
  role: 'behavior',
  consumes:
    how === 'log_order'
      ? { log: 'normalized_log' }
      : { log: 'normalized_log', graph: 'workspace_graph' },
  provides: ['root_failure'],
  replaces: ['locate_root_cause'],
  requires: NO_PERMS,
  cost: how === 'log_order' ? 1 : 3,
  mutating: false,
  run: (_ctx, args) => {
    const log = rec<NormalizedLog>(args.log, 'normalized log');
    const graph = args.graph ? rec<WorkspaceGraph>(args.graph, 'workspace graph') : null;
    const root = locateRoot(log.errors, graph, how);
    if (!root) throw new Error('The log contains no errors');
    return Promise.resolve({
      output: { root_failure: root, located_by: how },
      confidence: how === 'log_order' ? 0.95 : 0.97,
      summary: `Root cause: ${root.code} in ${root.workspace} (${how === 'log_order' ? 'first error line' : 'no failing dependency'})`,
    });
  },
  agrees: (recorded, produced) => sameRoot(recorded, produced),
});

const SELECT_REMEDY_BOUNDARY: BoundarySpec = {
  question:
    "Which candidate replacement resolves the failing import while preserving the call site's intent?",
  kind: 'choose_option',
  optionsFrom: 'steps.$self.output.candidates',
  resolveInto: 'remedy',
  evidenceSelectors: [
    { id: 'error', tags: ['error'], required: true },
    { id: 'call_site', tags: ['call_site'], required: true },
    { id: 'candidates', tags: ['candidate_signature'], required: true },
  ],
  budgetTokens: 1500,
  minCapability: 'standard',
  evidenceRequired: 'A choice among the listed option ids with a one or two sentence rationale',
  verifyBy: 'Rebuild and run the workspace tests; the independent verifier must pass',
};

export function createMonorepoLibrary(): OperatorLibrary {
  const lib = new OperatorLibrary();

  lib.register({
    id: 'local.read_ci_log',
    version: '1.0.0',
    stepId: 'ingest',
    intent: 'ingest_failure',
    title: 'Read CI log',
    description: 'Reads the captured CI failure log artifact.',
    kind: 'known',
    role: 'infra',
    consumes: { path: 'input.ci_log' },
    provides: ['ci_log'],
    replaces: ['read_failure_log'],
    requires: { read: ['ci/*.log'], write: [], commands: [] },
    cost: 1,
    mutating: false,
    run: async (ctx, args) => {
      const path = str(args.path, 'ci_log path');
      const text = await ctx.tools.readFile(path, 'read_failure_log');
      ctx.evidence.add({ source: 'ci-log', text, tags: ['log'] });
      return {
        output: { ci_log: { path, text, bytes: Buffer.byteLength(text) } },
        summary: `Read ${path} (${text.split('\n').length} lines)`,
      };
    },
    agrees: (r) => ({
      ok: r.toolCalls.some((t) => t.tool === 'read_file' && asText(t.args.path).startsWith('ci/')),
      detail: 'baseline read the CI log artifact',
    }),
  });

  lib.register({
    id: 'local.workspace_graph',
    version: '1.0.0',
    stepId: 'graph',
    intent: 'inspect_workspace_graph',
    title: 'Read workspace dependency graph',
    description: 'Runs `forge-ci graph --json` to obtain workspaces and their dependencies.',
    kind: 'known',
    role: 'behavior',
    consumes: {},
    provides: ['workspace_graph'],
    replaces: ['inspect_workspace_graph'],
    requires: { read: [], write: [], commands: ['forge-ci graph'] },
    cost: 1,
    mutating: false,
    run: async (ctx) => {
      const out = await ctx.tools.run(
        { program: 'forge-ci', args: ['graph', '--json'] },
        'inspect_workspace_graph',
      );
      if (!out.ok) throw new Error('forge-ci graph failed');
      const graph = parseGraph(out.output.split('\n[stderr]')[0] ?? '');
      ctx.evidence.add({ source: 'workspace-graph', text: out.output, tags: ['graph'] });
      return {
        output: { workspace_graph: graph },
        summary: `${graph.workspaces.length} workspaces in dependency order`,
      };
    },
    agrees: (r) => ({
      ok: toolCommand(r, 'forge-ci graph --json'),
      detail: 'baseline read the workspace graph the same way',
    }),
  });

  lib.register({
    id: 'local.snapshot_tree',
    version: '1.0.0',
    stepId: 'snapshot',
    intent: 'snapshot_before_change',
    title: 'Snapshot files before any change',
    description: 'Records file hashes so unrelated changes can be detected after the repair.',
    kind: 'validation',
    role: 'verification',
    consumes: {},
    provides: ['before_snapshot'],
    replaces: [],
    requires: NO_PERMS,
    cost: 1,
    mutating: false,
    runsBefore: ['patch'],
    run: async (ctx) => {
      const snap = await ctx.sandbox.snapshotFiles();
      return {
        output: { before_snapshot: snap },
        summary: `Snapshot of ${Object.keys(snap.hashes).length} files`,
      };
    },
  });

  lib.register({
    id: 'local.normalize_log',
    version: '1.0.0',
    stepId: 'normalize',
    intent: 'normalize_log',
    title: 'Normalize the build log',
    description:
      'Strips ANSI codes, timestamps and noise; extracts structured errors in log order.',
    kind: 'known',
    role: 'behavior',
    consumes: { log: 'ci_log' },
    provides: ['normalized_log'],
    replaces: ['read_failure_log'],
    requires: NO_PERMS,
    cost: 1,
    mutating: false,
    stopWhen: [
      { op: 'eq', left: { ref: 'steps.$self.output.recognized' }, right: { const: false } },
      { op: 'eq', left: { ref: 'steps.$self.output.error_count' }, right: { const: 0 } },
    ],
    run: (ctx, args) => {
      const log = rec<{ text: string }>(args.log, 'ci log');
      const parsed = parseBuildLog(log.text);
      const text = normalizeLog(log.text);
      ctx.evidence.add({ source: 'normalized-log', text, tags: ['log_normalized'] });
      const normalized: NormalizedLog = {
        text,
        errors: parsed.errors,
        failedWorkspaces: parsed.failedWorkspaces,
        mode: parsed.mode,
        toolchain: parsed.toolchain,
      };
      return Promise.resolve({
        output: {
          normalized_log: normalized,
          error_count: parsed.errors.length,
          recognized: parsed.toolchain !== null,
        },
        summary: `${parsed.errors.length} error(s) in ${parsed.failedWorkspaces.length} failed workspace(s); ${parsed.warningCount} warnings ignored`,
      });
    },
  });

  lib.register(locateOperator('log_order'), locateOperator('dependency_graph'));

  lib.register({
    id: 'local.map_workspace',
    version: '1.0.0',
    stepId: 'map',
    intent: 'map_workspace',
    title: 'Map the error to its workspace and owner',
    description: "Reads the failing workspace's manifest and CODEOWNERS entry.",
    kind: 'known',
    role: 'behavior',
    consumes: { root: 'root_failure', graph: 'workspace_graph' },
    provides: ['failing_workspace'],
    replaces: ['inspect_failing_workspace'],
    requires: {
      read: ['packages/*/package.json', 'apps/*/package.json', 'CODEOWNERS'],
      write: [],
      commands: [],
    },
    cost: 1,
    mutating: false,
    run: async (ctx, args) => {
      const root = rec<RootFailureData>(args.root, 'root failure');
      const graph = rec<WorkspaceGraph>(args.graph, 'workspace graph');
      const ws: GraphWorkspace | undefined = workspaceByPath(graph, root.workspace);
      if (!ws) throw new Error(`Workspace ${root.workspace} is not in the graph`);
      const manifest = await ctx.tools.readFile(
        `${ws.path}/package.json`,
        'inspect_failing_workspace',
      );
      const owners = await ctx.sandbox.readFile('CODEOWNERS').catch(() => '');
      const owner =
        owners
          .split('\n')
          .find((l) => l.startsWith(`/${ws.path}/`))
          ?.split(/\s+/)[1] ?? null;
      ctx.evidence.add({
        source: `file:${ws.path}/package.json`,
        text: manifest,
        tags: ['manifest'],
      });
      return {
        output: {
          failing_workspace: { path: ws.path, name: ws.name, version: ws.version, owner, manifest },
        },
        summary: `${ws.name} v${ws.version}${owner ? `, owned by ${owner}` : ''}`,
      };
    },
    agrees: (r, p) => {
      const manifestRead = r.toolCalls.some(
        (t) => t.tool === 'read_file' && asText(t.args.path).endsWith('/package.json'),
      );
      const got = p.output.failing_workspace as { path?: string } | undefined;
      return {
        ok: manifestRead && !!got?.path,
        detail: `baseline inspected ${got?.path ?? '?'}/package.json`,
      };
    },
  });

  lib.register({
    id: 'local.focused_diagnostic',
    version: '1.0.0',
    stepId: 'diagnose',
    intent: 'run_focused_diagnostic',
    title: 'Run a focused diagnostic build',
    description:
      'Builds only the failing workspace (and its dependencies) with verbose resolution output.',
    kind: 'validation',
    role: 'behavior',
    consumes: { workspace: 'failing_workspace' },
    provides: ['diagnostic'],
    replaces: ['run_focused_diagnostic'],
    requires: { read: [], write: [], commands: ['forge-ci build'] },
    cost: 1,
    mutating: false,
    run: async (ctx, args) => {
      const ws = rec<{ path: string }>(args.workspace, 'failing workspace');
      const out = await ctx.tools.run(
        { program: 'forge-ci', args: ['build', '--workspace', ws.path, '--verbose'] },
        'run_focused_diagnostic',
      );
      ctx.evidence.add({ source: `diagnostic:${ws.path}`, text: out.output, tags: ['diagnostic'] });
      return {
        output: { diagnostic: { text: out.output, exitCode: out.exitCode } },
        summary: `Focused build of ${ws.path} exited ${out.exitCode ?? 'n/a'}`,
      };
    },
    agrees: (r, p) => {
      const ws = (p.output.diagnostic as { text?: string } | undefined) ? true : false;
      return {
        ok:
          ws &&
          r.toolCalls.some(
            (t) => t.tool === 'run_command' && asText(t.args.command).includes('--verbose'),
          ),
        detail: 'baseline ran the same focused diagnostic',
      };
    },
  });

  lib.register({
    id: 'local.select_remedy',
    version: '1.0.0',
    stepId: 'decide',
    intent: 'decide_remedy',
    title: 'Select the remedy',
    description:
      'Gathers the evidence its rules need (lockfile, dependency exports or manifests) and ranks candidate remedies. Reports low confidence when candidates are close, which opens the uncertainty boundary.',
    kind: 'hybrid',
    role: 'behavior',
    consumes: {
      root: 'root_failure',
      workspace: 'failing_workspace',
      graph: 'workspace_graph',
      diagnostic: 'diagnostic',
    },
    provides: ['remedy'],
    replaces: [
      'inspect_lockfile',
      'inspect_failing_source',
      'inspect_dependency_exports',
      'inspect_dependency_manifest',
      'decide_remedy',
    ],
    requires: { read: ['forge.lock.json', 'packages/**', 'apps/**'], write: [], commands: [] },
    cost: 2,
    mutating: false,
    escalation: { threshold: 0.8, boundary: SELECT_REMEDY_BOUNDARY },
    stopWhen: [
      { op: 'eq', left: { ref: 'steps.$self.output.candidate_count' }, right: { const: 0 } },
    ],
    run: async (ctx, args) => {
      const root = rec<RootFailureData>(args.root, 'root failure');
      const ws = rec<{ path: string; manifest: string }>(args.workspace, 'failing workspace');
      const graph = rec<WorkspaceGraph>(args.graph, 'workspace graph');
      const files: FileMap = { [`${ws.path}/package.json`]: ws.manifest };
      for (let i = 0; i < 8; i += 1) {
        const need = nextFileNeeded(root, files, graph);
        if (!need) break;
        files[need.path] = await ctx.tools.readFile(need.path, need.purpose);
      }
      const analysis = analyseRemedy(root, files, graph);
      for (const e of analysis.evidence) ctx.evidence.add(e);
      for (const [path, text] of Object.entries(files))
        ctx.evidence.add({ source: `file:${path}`, text, tags: ['source'] });
      const options: Candidate[] = analysis.candidates;
      return {
        output: {
          candidates: options,
          candidate_count: options.length,
          remedy: options[0]?.payload ?? null,
          resolved_by: 'local',
        },
        confidence: analysis.confidence,
        summary: analysis.summary,
      };
    },
    agrees: (r, p) => {
      const decision = r.decisions.find((d) => d.intent === 'decide_remedy')?.output as
        { file?: string; edits?: unknown } | undefined;
      const remedy = p.output.remedy as Remedy | null;
      const ok =
        !!decision &&
        !!remedy &&
        decision.file === remedy.patch.file &&
        JSON.stringify(decision.edits) === JSON.stringify(remedy.patch.edits);
      return { ok, detail: ok ? `same patch to ${remedy?.patch.file}` : 'different patch' };
    },
  });

  lib.register({
    id: 'local.apply_remedy',
    version: '1.0.0',
    stepId: 'patch',
    intent: 'apply_remedy',
    title: 'Apply the remedy',
    description: 'Applies the structured search/replace patch inside the failing workspace.',
    kind: 'known',
    role: 'behavior',
    consumes: { remedy: 'remedy' },
    provides: ['applied'],
    replaces: ['apply_remedy'],
    requires: {
      read: ['packages/**', 'apps/**'],
      write: [
        'packages/*/package.json',
        'packages/*/src/**',
        'apps/*/package.json',
        'apps/*/src/**',
      ],
      commands: [],
    },
    cost: 1,
    mutating: true,
    run: async (ctx, args) => {
      const remedy =
        args.remedy === null || args.remedy === undefined
          ? null
          : rec<Remedy>(args.remedy, 'remedy');
      if (!remedy) throw new Error('No remedy to apply');
      const { file, edits } = remedy.patch;
      const { before, after } = await ctx.tools.applyPatch(file, edits, 'apply_remedy');
      return {
        output: {
          applied: { file, kind: remedy.kind, description: remedy.description, before, after },
        },
        summary: `Patched ${file}: ${remedy.description}`,
      };
    },
    agrees: (r, p) => {
      const call = r.toolCalls.find((t) => t.tool === 'apply_patch');
      const applied = p.output.applied as { file?: string } | undefined;
      return {
        ok: !!call && call.args.file === applied?.file,
        detail: `baseline patched ${asText(call?.args.file) || '?'}`,
      };
    },
  });

  lib.register({
    id: 'local.rerun_build',
    version: '1.0.0',
    stepId: 'rebuild',
    intent: 'verify_build',
    title: 'Rebuild the monorepo',
    description: 'Runs the full build to confirm the original failure is gone.',
    kind: 'validation',
    role: 'behavior',
    consumes: { applied: 'applied' },
    provides: ['rebuild'],
    replaces: ['verify_build'],
    requires: { read: [], write: [], commands: ['forge-ci build'] },
    cost: 1,
    mutating: false,
    run: async (ctx) => {
      const out = await ctx.tools.run({ program: 'forge-ci', args: ['build'] }, 'verify_build');
      return {
        output: { rebuild: { ok: out.ok, text: out.output, exitCode: out.exitCode } },
        summary: out.ok ? 'Full build passes' : 'Full build still fails',
      };
    },
    agrees: (r) => ({
      ok: toolCommand(r, 'forge-ci build'),
      detail: 'baseline rebuilt the monorepo',
    }),
  });

  lib.register({
    id: 'local.run_tests',
    version: '1.0.0',
    stepId: 'test',
    intent: 'verify_tests',
    title: 'Run the workspace tests',
    description: 'Runs the failing workspace tests.',
    kind: 'validation',
    role: 'behavior',
    consumes: { workspace: 'failing_workspace', applied: 'applied' },
    provides: ['tests'],
    replaces: ['verify_tests'],
    requires: { read: [], write: [], commands: ['forge-ci test'] },
    cost: 1,
    mutating: false,
    run: async (ctx, args) => {
      const ws = rec<{ path: string }>(args.workspace, 'failing workspace');
      const out = await ctx.tools.run(
        { program: 'forge-ci', args: ['test', '--workspace', ws.path] },
        'verify_tests',
      );
      return {
        output: { tests: { ok: out.ok, text: out.output, exitCode: out.exitCode } },
        summary: out.ok ? `Tests pass in ${ws.path}` : `Tests fail in ${ws.path}`,
      };
    },
    agrees: (r) => ({
      ok: r.toolCalls.some(
        (t) => t.tool === 'run_command' && asText(t.args.command).startsWith('forge-ci test'),
      ),
      detail: 'baseline ran the workspace tests',
    }),
  });

  lib.register({
    id: 'local.verify_outcome',
    version: '1.0.0',
    stepId: 'verify',
    intent: 'verify_outcome',
    title: 'Verify against declared evidence',
    description:
      'Evaluates original_failure_gone, relevant_tests_pass, no_unrelated_changes and security_policy_pass.',
    kind: 'verification',
    role: 'verification',
    consumes: {
      before: 'before_snapshot',
      rebuild: 'rebuild',
      tests: 'tests',
      root: 'root_failure',
      applied: 'applied',
      log: 'normalized_log',
      graph: 'workspace_graph',
    },
    provides: ['verification'],
    replaces: [],
    requires: NO_PERMS,
    cost: 1,
    mutating: false,
    stopWhen: [{ op: 'eq', left: { ref: 'steps.$self.output.passed' }, right: { const: false } }],
    run: async (ctx, args) => {
      const before = rec<Snapshot>(args.before, 'snapshot');
      const rebuild = rec<{ ok: boolean; text: string }>(args.rebuild, 'rebuild result');
      const tests = rec<{ ok: boolean; text: string }>(args.tests, 'test result');
      const log = rec<NormalizedLog>(args.log, 'normalized log');
      const graph = rec<WorkspaceGraph>(args.graph, 'workspace graph');
      const root = locateRoot(log.errors, graph, 'dependency_graph');
      const after = await ctx.sandbox.snapshotFiles();
      const report = evaluateRules(
        {
          rebuild,
          tests,
          originalErrors: log.errors,
          rootWorkspace: root?.workspace ?? '(unknown)',
          before,
          after,
        },
        new Date().toISOString(),
      );
      return {
        output: { verification: report, passed: report.status === 'pass' },
        summary: `Verification ${report.status}: ${report.rules.filter((r) => r.status === 'pass').length}/${report.rules.length} rules pass`,
      };
    },
  });

  lib.register({
    id: 'local.render_report',
    version: '1.0.0',
    stepId: 'report',
    intent: 'report',
    title: 'Render the report',
    description:
      'Writes a short markdown report of the root cause, the change, and the verification evidence.',
    kind: 'known',
    role: 'behavior',
    consumes: { root: 'root_failure', applied: 'applied', verification: 'verification' },
    provides: ['report'],
    replaces: ['report'],
    requires: NO_PERMS,
    cost: 1,
    mutating: false,
    run: (_ctx, args) => {
      const root = rec<RootFailureData>(args.root, 'root failure');
      const applied = rec<{ file: string; description: string }>(args.applied, 'applied remedy');
      const v = rec<{
        rules: { label: string; status: string; evidence: string }[];
        status: string;
      }>(args.verification, 'verification');
      const report = [
        `## Build repaired: ${root.workspace}`,
        `- **Root cause:** \`${root.code}\` ${root.message}`,
        `- **Change:** ${applied.description} (\`${applied.file}\`)`,
        `- **Verification (${v.status}):**`,
        ...v.rules.map((r) => `  - ${r.status === 'pass' ? '✔' : '✖'} ${r.label}: ${r.evidence}`),
      ].join('\n');
      return Promise.resolve({ output: { report }, summary: 'Report rendered' });
    },
  });

  return lib;
}
