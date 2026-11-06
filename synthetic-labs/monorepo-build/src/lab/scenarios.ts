import { catalogVersion } from './generator';
import type { FaultKind, NegativeTask, ScenarioDetail, ScenarioRole, ScenarioSpec } from './types';

/** Paraphrased user requests: the same task family must be recognised across all of them. */
export const PROMPTS: readonly string[] = [
  'Why is CI red on main? Find the root cause of the build failure and fix it.',
  'Find my build failure.',
  'What is the first real error in this monorepo build? Fix whatever is broken.',
  'Which workspace broke the build? Diagnose it and repair it.',
  'CI is failing after the latest merge. Figure out what is wrong and fix it.',
  'The monorepo build is red. Please diagnose the failure and get the build green again.',
  'Build failed in the pipeline: track down the underlying problem and resolve it.',
];

interface Def {
  id: string;
  role: ScenarioRole;
  fault: FaultKind;
  workspace: string;
  seed: number;
  ambiguous?: boolean;
  detail: ScenarioDetail;
  code: string;
}

const MD = (module: string): ScenarioDetail => ({ module });
const ME = (dependency: string, requested: string, expectedChoice: string): ScenarioDetail => ({
  dependency,
  requested,
  expectedChoice,
});
const VM = (range = '^2.0.0'): ScenarioDetail => ({ dependency: '@acme/core', range });

const DEFS: Def[] = [
  // Learning set: solved by the baseline agent while BigForge observes.
  {
    id: 'L1',
    role: 'learning',
    fault: 'missing_dependency',
    workspace: 'packages/security',
    seed: 4217,
    detail: MD('jsonwebtoken'),
    code: 'TS2307',
  },
  {
    id: 'L2',
    role: 'learning',
    fault: 'missing_export',
    workspace: 'packages/auth',
    seed: 1103,
    detail: ME('@acme/security', 'hashPwd', 'hashPassword'),
    code: 'TS2305',
  },
  {
    id: 'L3',
    role: 'learning',
    fault: 'version_mismatch',
    workspace: 'packages/billing',
    seed: 7781,
    detail: VM(),
    code: 'ERR_WORKSPACE_VERSION',
  },
  {
    id: 'L4',
    role: 'learning',
    fault: 'missing_dependency',
    workspace: 'packages/telemetry',
    seed: 2290,
    detail: MD('pino'),
    code: 'TS2307',
  },
  {
    id: 'L5',
    role: 'learning',
    fault: 'missing_export',
    workspace: 'packages/ui-kit',
    seed: 9054,
    detail: ME('@acme/core', 'fmtDate', 'formatDate'),
    code: 'TS2305',
  },
  // Shadow set: new tasks executed by both the baseline agent and the candidate Reflex.
  {
    id: 'S1',
    role: 'shadow',
    fault: 'missing_dependency',
    workspace: 'packages/billing',
    seed: 3312,
    detail: MD('decimal.js'),
    code: 'TS2307',
  },
  {
    id: 'S2',
    role: 'shadow',
    fault: 'missing_dependency',
    workspace: 'packages/ui-kit',
    seed: 5561,
    detail: MD('clsx'),
    code: 'TS2307',
  },
  {
    id: 'S3',
    role: 'shadow',
    fault: 'missing_dependency',
    workspace: 'packages/auth',
    seed: 6628,
    detail: MD('bcryptjs'),
    code: 'TS2307',
  },
  {
    id: 'S4',
    role: 'shadow',
    fault: 'missing_export',
    workspace: 'packages/billing',
    seed: 1871,
    detail: ME('@acme/core', 'fmtMoney', 'formatMoney'),
    code: 'TS2305',
  },
  {
    id: 'S5',
    role: 'shadow',
    fault: 'missing_export',
    workspace: 'packages/telemetry',
    seed: 8830,
    detail: ME('@acme/core', 'fmtDate', 'formatDate'),
    code: 'TS2305',
  },
  {
    id: 'S6',
    role: 'shadow',
    fault: 'missing_export',
    workspace: 'packages/security',
    seed: 4409,
    detail: ME('@acme/core', 'clampValue', 'clamp'),
    code: 'TS2305',
  },
  {
    id: 'S7',
    role: 'shadow',
    fault: 'version_mismatch',
    workspace: 'packages/telemetry',
    seed: 7102,
    detail: VM(),
    code: 'ERR_WORKSPACE_VERSION',
  },
  {
    id: 'S8',
    role: 'shadow',
    fault: 'version_mismatch',
    workspace: 'packages/ui-kit',
    seed: 2947,
    detail: VM('^3.1.0'),
    code: 'ERR_WORKSPACE_VERSION',
  },
  {
    id: 'S9',
    role: 'shadow',
    fault: 'version_mismatch',
    workspace: 'packages/security',
    seed: 6015,
    detail: VM(),
    code: 'ERR_WORKSPACE_VERSION',
  },
  {
    id: 'S10',
    role: 'shadow',
    fault: 'version_mismatch',
    workspace: 'packages/auth',
    seed: 3786,
    detail: VM('^2.2.0'),
    code: 'ERR_WORKSPACE_VERSION',
  },
  {
    id: 'S11',
    role: 'shadow',
    fault: 'missing_dependency',
    workspace: 'packages/security',
    seed: 9921,
    detail: MD('jsonwebtoken'),
    code: 'TS2307',
  },
  {
    id: 'S12',
    role: 'shadow',
    fault: 'missing_export',
    workspace: 'packages/auth',
    seed: 5238,
    detail: ME('@acme/security', 'hashPwd', 'hashPassword'),
    code: 'TS2305',
  },
  // Held-out task for the killer moment: two plausible remedies.
  {
    id: 'K1',
    role: 'held_out',
    fault: 'missing_export',
    workspace: 'packages/auth',
    seed: 8104,
    ambiguous: true,
    detail: ME('@acme/security', 'signJwt', 'signAccessToken'),
    code: 'TS2305',
  },
];

const FAULT_TITLES: Record<FaultKind, (d: ScenarioDetail) => string> = {
  missing_dependency: (d) => `Undeclared dependency "${d.module ?? ''}"`,
  missing_export: (d) => `Stale import "${d.requested ?? ''}" from ${d.dependency ?? ''}`,
  version_mismatch: (d) => `Workspace range ${d.range ?? ''} for ${d.dependency ?? ''}`,
};

function build(def: Def, index: number): ScenarioSpec {
  const ambiguous = def.ambiguous ?? false;
  return {
    id: def.id,
    role: def.role,
    fault: def.fault,
    workspace: def.workspace,
    seed: def.seed,
    ambiguous,
    variantKey: `${def.fault}${ambiguous ? '+ambiguous' : ''}@${def.workspace}`,
    title: `${FAULT_TITLES[def.fault](def.detail)} in ${def.workspace}`,
    prompt: PROMPTS[index % PROMPTS.length] as string,
    detail: def.detail,
    expected: { rootWorkspace: def.workspace, code: def.code },
  };
}

export const SCENARIOS: readonly ScenarioSpec[] = DEFS.map(build);

export function getScenario(id: string): ScenarioSpec {
  const found = SCENARIOS.find((s) => s.id === id);
  if (!found) throw new Error(`Unknown scenario: ${id}`);
  return found;
}

export const LEARNING_IDS: readonly string[] = SCENARIOS.filter((s) => s.role === 'learning').map(
  (s) => s.id,
);
export const SHADOW_IDS: readonly string[] = SCENARIOS.filter((s) => s.role === 'shadow').map(
  (s) => s.id,
);
export const HELD_OUT_ID = 'K1';
/** The "familiar tasks" sampled by the Drift Canary (all shadow tasks). */
export const CANARY_IDS: readonly string[] = SHADOW_IDS;

export function expectedVersionFor(spec: ScenarioSpec): string | undefined {
  return spec.fault === 'missing_dependency' && spec.detail.module
    ? catalogVersion(spec.detail.module)
    : undefined;
}

const TEST_LOG = [
  'FAIL packages/billing/src/invoice.test.ts',
  '  ✖ adds tax › expected "12.00 USD" but received "11.99 USD"',
  '  1 failed, 4 passed',
].join('\n');
const LINT_LOG = [
  '/repo/apps/web/src/app.tsx',
  '  14:7  error  Unexpected any. Specify a different type  @typescript-eslint/no-explicit-any',
  '✖ 3 problems (3 errors, 0 warnings)',
].join('\n');
const PY_LOG = [
  'Traceback (most recent call last):',
  '  File "pipeline/run.py", line 88, in <module>',
  'TimeoutError: job exceeded 3600s',
].join('\n');
const DOCKER_LOG = [
  'Step 6/9 : RUN npm ci',
  'ERROR: failed to solve: no space left on device',
].join('\n');
const GRADLE_LOG = [
  '> Task :app:compileJava FAILED',
  'Could not resolve com.acme:core:2.4.0.',
  '* What went wrong: Execution failed for task :app:compileJava',
].join('\n');

/** Hand-written out-of-family tasks used to measure the false Reflex match rate. */
export const NEGATIVE_TASKS: readonly NegativeTask[] = [
  {
    id: 'N1',
    title: 'Feature request',
    prompt: 'Add a dark mode toggle to the settings page.',
    log: null,
    reason: 'Not a failure investigation',
  },
  {
    id: 'N2',
    title: 'Flaky test',
    prompt: 'Why is the billing unit test failing in CI? Fix it.',
    log: TEST_LOG,
    reason: 'Test failure, not a build failure',
  },
  {
    id: 'N3',
    title: 'Dependency upgrade',
    prompt: 'Update all dependencies to the latest minor versions.',
    log: null,
    reason: 'Maintenance task',
  },
  {
    id: 'N4',
    title: 'Deploy failure',
    prompt: 'The deploy to staging is failing with a 502. What is wrong?',
    log: 'deploy: health check failed: HTTP 502 from /health',
    reason: 'Deploy failure',
  },
  {
    id: 'N5',
    title: 'Lint failure',
    prompt: 'CI is red because of lint errors in the web app. Fix them.',
    log: LINT_LOG,
    reason: 'Lint failure',
  },
  {
    id: 'N6',
    title: 'Release notes',
    prompt: 'Write release notes for v2.4.0.',
    log: null,
    reason: 'Documentation task',
  },
  {
    id: 'N7',
    title: 'Python pipeline',
    prompt: 'CI is red because the data pipeline times out. Diagnose it.',
    log: PY_LOG,
    reason: 'Different toolchain and failure type',
  },
  {
    id: 'N8',
    title: 'Slow build',
    prompt: 'The monorepo build is slow. Make it faster.',
    log: null,
    reason: 'Performance task, not a failure',
  },
  {
    id: 'N9',
    title: 'Rename refactor',
    prompt: 'Rename the formatDate export to formatDay across the repo.',
    log: null,
    reason: 'Refactor, even though it mentions exports',
  },
  {
    id: 'N10',
    title: 'Docker build',
    prompt: 'Why is the docker build failing in CI?',
    log: DOCKER_LOG,
    reason: 'Different toolchain',
  },
  {
    id: 'N11',
    title: 'Gradle build',
    prompt: 'The build failed. Find the failing module and fix it.',
    log: GRADLE_LOG,
    reason: 'Different toolchain (Gradle)',
  },
  {
    id: 'N12',
    title: 'Explain only',
    prompt: 'Explain how the CI pipeline is organised.',
    log: null,
    reason: 'Explanation request',
  },
];
