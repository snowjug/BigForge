/**
 * The Forge loop shown in the top strip: Observe, Fingerprint, Compile, Validate, Execute, Escalate, Evolve.
 * Which stage glows is derived from the current route, refined by the guided-demo step, and can be
 * overridden by a page (see useForgeStage in shell/stageStore.ts).
 */

export const FORGE_STAGES = [
  {
    id: 'observe',
    label: 'Observe',
    summary:
      'Capture traces of successful agent runs: tool calls, evidence, verification, token cost.',
  },
  {
    id: 'fingerprint',
    label: 'Fingerprint',
    summary:
      'Assign each task to a family by intent, toolchain, failure type and error patterns, not by exact prompt.',
  },
  {
    id: 'compile',
    label: 'Compile',
    summary: 'Turn repeated traces into a candidate Reflex: typed, versioned, constrained.',
  },
  {
    id: 'validate',
    label: 'Validate',
    summary: 'Replay, shadow-execute, then require human approval before anything runs live.',
  },
  {
    id: 'execute',
    label: 'Execute',
    summary: 'Run known steps through the Reflex in a sandbox. Completion requires verification.',
  },
  {
    id: 'escalate',
    label: 'Escalate',
    summary:
      'Cross the uncertainty boundary only for the unresolved decision, through the Token Firewall.',
  },
  {
    id: 'evolve',
    label: 'Evolve',
    summary: 'Outcomes feed drift detection, mutation and depreciation. Trust expires.',
  },
] as const;

export type ForgeStageId = (typeof FORGE_STAGES)[number]['id'];

const stageIds = new Set<string>(FORGE_STAGES.map((stage) => stage.id));
export const isForgeStage = (value: string): value is ForgeStageId => stageIds.has(value);

/** `/reflexes/abc?x=1` -> `/reflexes`; `/` stays `/`. */
export function pathRoot(pathname: string): string {
  const path = (pathname.split(/[?#]/)[0] ?? '').replace(/\/+$/, '') || '/';
  return `/${path.split('/')[1] ?? ''}`;
}

/** The stages a page belongs to, from its pathname. Pages with no pipeline role return an empty list. */
export function stagesForPath(pathname: string): ForgeStageId[] {
  switch (pathRoot(pathname)) {
    case '/run':
      return ['execute'];
    case '/traces':
      return ['observe'];
    case '/learn':
      return ['fingerprint', 'compile'];
    case '/reflexes':
    case '/shadow':
      return ['validate'];
    case '/drift':
      return ['evolve'];
    default:
      return [];
  }
}

/** Finer-grained stage for each guided-demo step (the killer moment crosses three stages on one page). */
export const DEMO_STEP_STAGES: Readonly<Record<string, readonly ForgeStageId[]>> = {
  failure_enters: ['observe'],
  baseline_handles: ['observe'],
  trace_captured: ['observe'],
  variations: ['observe'],
  family_found: ['fingerprint'],
  invariants: ['compile'],
  candidate: ['compile'],
  replay: ['validate'],
  shadow: ['validate'],
  compare: ['validate'],
  promote: ['validate'],
  new_task: ['fingerprint'],
  recognized: ['fingerprint'],
  known_steps: ['execute'],
  boundary: ['escalate'],
  firewall: ['escalate'],
  ai_resolves: ['escalate'],
  continues: ['execute'],
  verified: ['execute'],
  comparison: ['execute'],
  env_change: ['evolve'],
  canary: ['evolve'],
  confidence_falls: ['evolve'],
  back_to_shadow: ['evolve'],
  mutation: ['evolve'],
};

export interface StageSources {
  /** Set by a page through useForgeStage. Wins over everything else. */
  page: readonly ForgeStageId[] | null;
  /** The current demo step id while the presenter is open, and the pathname that step navigates to. */
  demo: { stepId: string; route: string } | null;
  pathname: string;
}

/** Resolves which stages are active: page override, then the demo step (when on its page), then the route. */
export function resolveActiveStages({ page, demo, pathname }: StageSources): ForgeStageId[] {
  if (page) return [...page];
  if (demo) {
    const staged = DEMO_STEP_STAGES[demo.stepId];
    const onDemoPage = pathRoot(pathname) === pathRoot(demo.route);
    if (staged && onDemoPage) return [...staged];
  }
  return stagesForPath(pathname);
}
