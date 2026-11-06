import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  type Clock,
  DEFAULT_AGENT_LIMITS,
  type ExecutionResult,
  type FirewallPolicy,
  type IdGenerator,
  InstrumentedTools,
  type OperatorLibrary,
  Sandbox,
  TokenFirewall,
  TraceRecorder,
  diffManifests,
  executeReflex,
  permissionSetFromSpec,
  runBaselineAgent,
  type AgentResult,
  BOUNDARY_POLICY_ID,
} from '@bigforge/core';
import {
  type LabEnvironment,
  MONOREPO_AGENT_POLICY_ID,
  type ScenarioSpec,
  type Snapshot,
  forgeCiPolicy,
  scenarioRepo,
  verifyRepository,
  writeRepo,
} from '@bigforge/lab-monorepo';
import { type Provider, costOf } from '@bigforge/providers';
import type {
  BoundaryResolution,
  JsonValue,
  Outcome,
  PricingConfig,
  ReflexSpec,
  RunKind,
  Trace,
  VerificationReport,
} from '@bigforge/schemas';
import { type CommandPolicy, type PermissionSet, runCommand } from '@bigforge/security';

export interface EngineDeps {
  dataDir: string;
  provider: Provider;
  pricing: PricingConfig;
  ids: IdGenerator;
  clock: Clock;
  library: OperatorLibrary;
  firewallPolicy: Omit<FirewallPolicy, 'estimateCostUsd'>;
  commandPolicy?: CommandPolicy;
  keepWorkspaces?: boolean;
}

export const AGENT_PERMISSIONS: PermissionSet = {
  read: ['**'],
  write: ['packages/**', 'apps/**'],
  commands: [{ program: 'forge-ci', subcommands: ['build', 'test', 'graph'] }],
};

const VERIFIER_PERMISSIONS: PermissionSet = {
  read: ['**'],
  write: [],
  commands: [{ program: 'forge-ci', subcommands: ['build', 'test', 'graph'] }],
};

export interface MaterializedTask {
  root: string;
  spec: ScenarioSpec;
  env: LabEnvironment;
  originalLog: string;
  before: Snapshot;
  dispose: () => Promise<void>;
}

/** Builds a scenario's broken repository in a fresh directory and captures its CI failure log. */
export async function materialize(
  deps: EngineDeps,
  spec: ScenarioSpec,
  env: LabEnvironment,
): Promise<MaterializedTask> {
  const base = path.join(deps.dataDir, 'workspaces');
  await mkdir(base, { recursive: true });
  const root = await mkdtemp(path.join(base, `${spec.id}-`));
  await writeRepo(root, scenarioRepo(spec, env));
  const policy = deps.commandPolicy ?? forgeCiPolicy();
  const built = await runCommand({ spec: { program: 'forge-ci', args: ['build'] }, policy, root });
  if (built.status !== 'completed' || built.exitCode !== 1) {
    await rm(root, { recursive: true, force: true });
    throw new Error(
      `Scenario ${spec.id} did not produce the expected build failure (exit ${String(built.exitCode)})`,
    );
  }
  await mkdir(path.join(root, 'ci'), { recursive: true });
  await writeFile(path.join(root, 'ci', 'last-build.log'), built.stdout, 'utf8');
  const probe = new Sandbox({ root, commandPolicy: policy, permissions: VERIFIER_PERMISSIONS });
  const before = await probe.snapshotFiles();
  return {
    root,
    spec,
    env,
    originalLog: built.stdout,
    before,
    dispose: async () => {
      if (!deps.keepWorkspaces) await rm(root, { recursive: true, force: true });
    },
  };
}

export interface FileChange {
  file: string;
  before: string;
  after: string;
}

export interface RunResult {
  trace: Trace;
  changes: FileChange[];
  execution: ExecutionResult | null;
  boundaries: BoundaryResolution[];
}

async function verify(
  deps: EngineDeps,
  mt: MaterializedTask,
): Promise<{ report: VerificationReport; changes: FileChange[] }> {
  const policy = deps.commandPolicy ?? forgeCiPolicy();
  const sandbox = new Sandbox({
    root: mt.root,
    commandPolicy: policy,
    permissions: VERIFIER_PERMISSIONS,
  });
  const scratch = new TraceRecorder({ ids: deps.ids, clock: deps.clock, pricing: deps.pricing });
  const report = await verifyRepository({
    tools: new InstrumentedTools(sandbox, scratch),
    before: mt.before,
    originalLog: mt.originalLog,
    verifiedAt: deps.clock.now().toISOString(),
  });
  const after = await sandbox.snapshotFiles();
  const diff = diffManifests(mt.before.hashes, after.hashes);
  const changes: FileChange[] = [...diff.added, ...diff.modified, ...diff.removed].map((file) => ({
    file,
    before: mt.before.texts[file] ?? '',
    after: after.texts[file] ?? '',
  }));
  return { report, changes };
}

function meta(mt: MaterializedTask): Pick<Trace, 'environment' | 'task'> {
  return {
    environment: {
      toolchain: { name: 'forge-ci', version: mt.env.toolchainVersion },
      platform: process.platform,
    },
    task: { prompt: mt.spec.prompt, scenarioId: mt.spec.id, variantKey: mt.spec.variantKey },
  };
}

function rootFailureFrom(result: AgentResult | null): Outcome['rootFailure'] {
  return result?.finish?.rootFailure ?? null;
}

export async function runBaseline(
  deps: EngineDeps,
  mt: MaterializedTask,
  options: {
    taskId: string;
    kind: Extract<RunKind, 'baseline' | 'shadow_baseline' | 'canary_baseline'>;
  },
): Promise<RunResult> {
  const recorder = new TraceRecorder({ ids: deps.ids, clock: deps.clock, pricing: deps.pricing });
  const policy = deps.commandPolicy ?? forgeCiPolicy();
  const sandbox = new Sandbox({
    root: mt.root,
    commandPolicy: policy,
    permissions: AGENT_PERMISSIONS,
    onSafety: (r) => recorder.safety(r),
  });
  const tools = new InstrumentedTools(sandbox, recorder);
  const result = await runBaselineAgent({
    config: {
      provider: deps.provider,
      tier: 'large',
      policyId: MONOREPO_AGENT_POLICY_ID,
      cacheKey: `${options.taskId}:${options.kind}`,
      ...DEFAULT_AGENT_LIMITS,
    },
    tools,
    recorder,
    prompt: mt.spec.prompt,
  });
  const { report, changes } = await verify(deps, mt);
  const success = report.status === 'pass';
  const trace = recorder.finish({
    taskId: options.taskId,
    runKind: options.kind,
    agent: { name: 'baseline-agent', kind: 'baseline', reflexId: null, reflexVersion: null },
    provider: {
      id: deps.provider.id,
      mode: deps.provider.mode,
      model: deps.provider.modelFor('large'),
    },
    ...meta(mt),
    outcome: {
      status: success ? 'success' : 'failed',
      summary: (result.finish?.summary ?? result.error ?? `Agent ended: ${result.status}`).slice(
        0,
        600,
      ),
      rootFailure: rootFailureFrom(result),
      remedyKind: result.finish?.remedyKind ?? null,
      remedySummary: result.finish?.remedySummary ?? null,
      changedFiles: changes.map((c) => c.file),
    },
    verification: report,
  });
  return { trace, changes, execution: null, boundaries: [] };
}

export function makeFirewall(deps: EngineDeps): TokenFirewall {
  return new TokenFirewall({
    ...deps.firewallPolicy,
    estimateCostUsd: (tier, inputTokens, outputTokens) =>
      costOf(deps.pricing, deps.provider.modelFor(tier), {
        inputTokens,
        outputTokens,
        cachedInputTokens: 0,
        provenance: 'estimated',
      }),
  });
}

/** The environment facts a Reflex's preconditions may reference. Read by the platform, not by the Reflex. */
export async function probeEnvironment(root: string): Promise<Record<string, JsonValue>> {
  try {
    const cfg = JSON.parse(await readFile(path.join(root, 'forge.config.json'), 'utf8')) as {
      toolchain?: { name?: string; version?: string };
    };
    const version = cfg.toolchain?.version ?? '0.0.0';
    return {
      toolchain_name: cfg.toolchain?.name ?? 'unknown',
      toolchain_version: version,
      toolchain_major: Number(version.split('.')[0]),
    };
  } catch {
    return { toolchain_name: 'unknown', toolchain_version: '0.0.0', toolchain_major: 0 };
  }
}

export async function runReflex(
  deps: EngineDeps,
  mt: MaterializedTask,
  spec: ReflexSpec,
  options: {
    taskId: string;
    kind: Extract<RunKind, 'reflex' | 'shadow_reflex' | 'replay_reflex' | 'canary_reflex'>;
    reflexId: string;
    allowBoundary: boolean;
  },
): Promise<RunResult> {
  const recorder = new TraceRecorder({ ids: deps.ids, clock: deps.clock, pricing: deps.pricing });
  const policy = deps.commandPolicy ?? forgeCiPolicy();
  const sandbox = new Sandbox({
    root: mt.root,
    commandPolicy: policy,
    permissions: permissionSetFromSpec(spec.permissions),
    onSafety: (r) => recorder.safety(r),
  });
  const execution = await executeReflex({
    spec,
    library: deps.library,
    sandbox,
    recorder,
    provider: deps.provider,
    firewall: makeFirewall(deps),
    ids: deps.ids,
    boundaryPolicyId: BOUNDARY_POLICY_ID,
    inputs: { ci_log: 'ci/last-build.log' },
    env: await probeEnvironment(mt.root),
    allowBoundary: options.allowBoundary,
  });
  const { report, changes } = await verify(deps, mt);
  const stopped = execution.status === 'stopped';
  const success = !stopped && report.status === 'pass';
  const root =
    (
      execution.ctx.steps.locate?.output as
        | {
            root_failure?: {
              workspace: string;
              code: string;
              message: string;
              file: string | null;
              line: number | null;
            };
          }
        | undefined
    )?.root_failure ?? null;
  const remedy =
    (
      execution.ctx.steps.decide?.output as
        { remedy?: { kind: string; description: string } | null } | undefined
    )?.remedy ?? null;
  const trace = recorder.finish({
    taskId: options.taskId,
    runKind: options.kind,
    agent: {
      name: `reflex:${spec.name}`,
      kind: 'reflex',
      reflexId: options.reflexId,
      reflexVersion: spec.version,
    },
    provider: {
      id: deps.provider.id,
      mode: deps.provider.mode,
      model: deps.provider.modelFor('standard'),
    },
    ...meta(mt),
    outcome: {
      status: stopped ? 'stopped' : success ? 'success' : 'failed',
      summary: stopped
        ? `Reflex stopped: ${execution.stopReason ?? 'unknown'}`
        : success
          ? 'Reflex completed and verification passed'
          : 'Reflex completed but verification failed',
      rootFailure: root
        ? {
            workspace: root.workspace,
            code: root.code,
            message: root.message,
            file: root.file,
            line: root.line,
          }
        : null,
      remedyKind: remedy?.kind ?? null,
      remedySummary: remedy?.description ?? null,
      changedFiles: changes.map((c) => c.file),
    },
    verification: report,
  });
  return { trace, changes, execution, boundaries: execution.boundaries };
}
