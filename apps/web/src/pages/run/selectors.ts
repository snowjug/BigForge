import type {
  FamilyMatch,
  ReflexListDto,
  ReflexStatus,
  ReflexVersionSummaryDto,
  RunKind,
  RunSummaryDto,
  ScenarioDto,
  TaskStatus,
} from '@bigforge/schemas';

/** Pure selectors for the Run Console: scenario grouping, default selection, run pairing, action availability. */

export type ScenarioRole = ScenarioDto['role'];

export const ROLE_ORDER: readonly ScenarioRole[] = ['learning', 'held_out', 'shadow'];

export const ROLE_LABEL: Record<ScenarioRole, { label: string; hint: string }> = {
  learning: {
    label: 'Learning',
    hint: 'Failures the baseline agent solves and BigForge learns from.',
  },
  shadow: {
    label: 'Shadow',
    hint: 'Used by Shadow Brain to compare a candidate Reflex with the AI.',
  },
  held_out: {
    label: 'Held out',
    hint: 'Never seen while learning: the test of a promoted Reflex.',
  },
};

export interface ScenarioGroup {
  role: ScenarioRole;
  label: string;
  hint: string;
  items: ScenarioDto[];
}

/** Learning first, then the held-out failure, then the shadow set; the catalogue order is kept inside a group. */
export function groupScenarios(scenarios: readonly ScenarioDto[]): ScenarioGroup[] {
  return ROLE_ORDER.map((role) => ({
    role,
    ...ROLE_LABEL[role],
    items: scenarios.filter((scenario) => scenario.role === role),
  })).filter((group) => group.items.length > 0);
}

/** The failure the next "Send failure" would send: the first scenario with no task yet, learning first. */
export function nextScenario(scenarios: readonly ScenarioDto[]): ScenarioDto | null {
  for (const group of groupScenarios(scenarios)) {
    const open = group.items.find((scenario) => scenario.taskId === null);
    if (open) return open;
  }
  return scenarios[0] ?? null;
}

export const FAULT_LABEL: Record<ScenarioDto['fault'], string> = {
  missing_dependency: 'missing dependency',
  missing_export: 'stale import',
  version_mismatch: 'version mismatch',
};

export type ScenarioState = 'not_sent' | TaskStatus;

export const SCENARIO_STATE: Record<
  ScenarioState,
  { label: string; tone: 'ash' | 'steel' | 'jade' | 'crimson' | 'amber' }
> = {
  not_sent: { label: 'Not sent', tone: 'ash' },
  received: { label: 'Received', tone: 'steel' },
  observed: { label: 'Observed', tone: 'amber' },
  solved: { label: 'Solved', tone: 'jade' },
  failed: { label: 'Failed', tone: 'crimson' },
};

export const scenarioState = (scenario: Pick<ScenarioDto, 'taskStatus'>): ScenarioState =>
  scenario.taskStatus ?? 'not_sent';

/* ----------------------------------------------------------------------------------------------- *
 * Runs
 * ----------------------------------------------------------------------------------------------- */

export const REFLEX_KINDS: readonly RunKind[] = [
  'reflex',
  'shadow_reflex',
  'replay_reflex',
  'canary_reflex',
];
export const BASELINE_KINDS: readonly RunKind[] = [
  'baseline',
  'shadow_baseline',
  'canary_baseline',
];

export const isReflexKind = (kind: RunKind): boolean => REFLEX_KINDS.includes(kind);
export const isBaselineKind = (kind: RunKind): boolean => BASELINE_KINDS.includes(kind);

export const KIND_LABEL: Record<RunKind, string> = {
  baseline: 'Baseline',
  reflex: 'Reflex',
  shadow_baseline: 'Shadow baseline',
  shadow_reflex: 'Shadow Reflex',
  replay_reflex: 'Replay Reflex',
  canary_baseline: 'Canary baseline',
  canary_reflex: 'Canary Reflex',
};

/** Runs the console started itself ("live"), as opposed to validation runs made by replay, shadow and canary. */
export const isLiveKind = (kind: RunKind): boolean => kind === 'baseline' || kind === 'reflex';

/**
 * The run to show when none is selected: the newest live Reflex run, else the newest standalone baseline
 * run, else the newest run of any kind. `runs` is oldest first (as the API returns it).
 */
export function defaultRun<T extends Pick<RunSummaryDto, 'kind' | 'groupId'>>(
  runs: readonly T[],
): T | null {
  const newest = (predicate: (run: T) => boolean): T | null => {
    for (let index = runs.length - 1; index >= 0; index -= 1) {
      const run = runs[index];
      if (run && predicate(run)) return run;
    }
    return null;
  };
  return (
    newest((run) => run.kind === 'reflex') ??
    newest((run) => run.kind === 'baseline' && run.groupId === null) ??
    newest((run) => run.kind === 'baseline') ??
    newest(() => true)
  );
}

/** Which kind of comparison record belongs to a Reflex run of this kind. */
export function comparisonKindFor(kind: RunKind): 'live' | 'shadow' | 'canary' | 'replay' | null {
  switch (kind) {
    case 'reflex':
      return 'live';
    case 'shadow_reflex':
      return 'shadow';
    case 'canary_reflex':
      return 'canary';
    case 'replay_reflex':
      return 'replay';
    default:
      return null;
  }
}

export interface RunRelations {
  /** The Reflex run this baseline run was measured against (or fell back from). */
  partner: RunSummaryDto | null;
  /** How the selected baseline run relates to its partner. */
  role: 'reference' | 'fallback' | null;
  /** For a stopped Reflex run: the baseline run that took over. */
  fallback: RunSummaryDto | null;
}

/** Pairs runs through the group id the platform stamps on a Reflex run and the baseline runs it caused. */
export function relationsOf(
  selected: Pick<RunSummaryDto, 'id' | 'kind' | 'groupId' | 'status' | 'createdAt'>,
  runs: readonly RunSummaryDto[],
  referenceRunId: string | null,
): RunRelations {
  if (!selected.groupId) return { partner: null, role: null, fallback: null };
  const group = runs.filter((run) => run.groupId === selected.groupId && run.id !== selected.id);
  if (isReflexKind(selected.kind)) {
    const fallback =
      selected.status === 'stopped'
        ? (group.find((run) => run.kind === 'baseline' && run.id !== referenceRunId) ?? null)
        : null;
    return { partner: null, role: null, fallback };
  }
  const partner = group.find((run) => isReflexKind(run.kind)) ?? null;
  const role = partner
    ? partner.status === 'stopped' && selected.id !== referenceRunId
      ? 'fallback'
      : 'reference'
    : null;
  return { partner, role, fallback: null };
}

/* ----------------------------------------------------------------------------------------------- *
 * Which Reflex would run, and what the buttons may do
 * ----------------------------------------------------------------------------------------------- */

export const EXECUTABLE_STATUSES: readonly ReflexStatus[] = ['active', 'watch'];

const compareVersions = (a: string, b: string): number =>
  b.localeCompare(a, undefined, { numeric: true });

export interface ReflexChoice {
  reflexName: string;
  version: ReflexVersionSummaryDto;
}

/** Mirrors the server: the newest version of the family's Reflex that may execute live (active or watch). */
export function selectExecutable(
  reflexes: readonly ReflexListDto[] | undefined,
  familyId: string | null,
): ReflexChoice | null {
  if (!reflexes || !familyId) return null;
  const choices: ReflexChoice[] = [];
  for (const reflex of reflexes) {
    if (reflex.familyId !== familyId) continue;
    for (const version of reflex.versions) {
      if (EXECUTABLE_STATUSES.includes(version.status))
        choices.push({ reflexName: reflex.name, version });
    }
  }
  return choices.sort((a, b) => compareVersions(a.version.version, b.version.version))[0] ?? null;
}

/** The newest version of the family's Reflex in any status, to explain why none may run. */
export function newestVersionOf(
  reflexes: readonly ReflexListDto[] | undefined,
  familyId: string | null,
): ReflexChoice | null {
  if (!reflexes || !familyId) return null;
  const all: ReflexChoice[] = [];
  for (const reflex of reflexes) {
    if (reflex.familyId !== familyId) continue;
    for (const version of reflex.versions) all.push({ reflexName: reflex.name, version });
  }
  return all.sort((a, b) => compareVersions(a.version.version, b.version.version))[0] ?? null;
}

export interface ModeAvailability {
  enabled: boolean;
  /** Why the action is unavailable, or null. */
  reason: string | null;
}

export interface Availability {
  baseline: ModeAvailability;
  auto: ModeAvailability;
  compare: ModeAvailability;
}

const pct = (value: number): string => `${(value * 100).toFixed(1)}%`;

export function runAvailability(input: {
  canRun: boolean;
  taskStatus: TaskStatus;
  match: FamilyMatch | null;
  choice: ReflexChoice | null;
  newest: ReflexChoice | null;
}): Availability {
  const forbidden =
    'Running a task needs an operator, reviewer or admin. You are signed in with a read-only role.';
  if (!input.canRun) {
    const denied = { enabled: false, reason: forbidden };
    return { baseline: denied, auto: denied, compare: denied };
  }
  if (input.taskStatus === 'observed') {
    const denied = {
      enabled: false,
      reason:
        'This task was only observed. It is out of scope for the synthetic lab and cannot be executed.',
    };
    return { baseline: denied, auto: denied, compare: denied };
  }
  const baseline: ModeAvailability = { enabled: true, reason: null };
  let reason: string | null = null;
  const { match } = input;
  if (!match) {
    reason = 'This task has not been matched yet. Re-run matching first.';
  } else if (match.decision === 'no_match') {
    reason = `No family matched (score ${pct(match.score)}, threshold ${pct(match.threshold)}), so there is no Reflex to run. The baseline agent handles it.`;
  } else if (match.decision === 'ambiguous') {
    reason =
      'The match is ambiguous, so no Reflex is selected automatically. Run the baseline agent.';
  } else if (!input.choice) {
    reason = input.newest
      ? `${input.newest.reflexName} v${input.newest.version.version} is in ${input.newest.version.status}, which may not run live. A reviewer must promote it first.`
      : 'The matched family has no Reflex yet.';
  }
  const gated: ModeAvailability = { enabled: reason === null, reason };
  return { baseline, auto: gated, compare: gated };
}

/** The task-level headline for the decision: which path will it take? */
export function pathVerdict(input: { match: FamilyMatch | null; choice: ReflexChoice | null }): {
  path: 'reflex' | 'baseline';
  label: string;
} {
  if (input.match?.decision === 'match' && input.choice) {
    return {
      path: 'reflex',
      label: `Reflex ${input.choice.reflexName} v${input.choice.version.version}`,
    };
  }
  return { path: 'baseline', label: 'Baseline agent' };
}
