import type { ReflexStatus, TransitionDto } from '@bigforge/schemas';

/**
 * The Reflex lifecycle as a ribbon: candidate, replay, shadow, approval, active, with Watch beside Active
 * and the off-path states (recompile, deprecated, retired) appended when they are current. Return arcs
 * record the steps backwards (a rejection, a drift demotion). Mirrors packages/core/src/lifecycle.ts.
 */

export const MAIN_PATH = ['candidate', 'replay', 'shadow', 'approval', 'active'] as const;

/** Position on the ribbon. Watch sits right of Active; Recompile loops back through Shadow. */
const RANK: Record<ReflexStatus, number> = {
  candidate: 0,
  replay: 1,
  shadow: 2,
  recompile: 2.5,
  approval: 3,
  active: 4,
  watch: 4.5,
  deprecated: 8,
  retired: 9,
};

export const rankOf = (status: ReflexStatus): number => RANK[status];

export type RibbonState =
  /** Passed on the way to the current status. */
  | 'done'
  | 'current'
  /** Not reached yet. */
  | 'upcoming'
  /** Reached earlier but left again (a Reflex returned to Shadow was Active before). */
  | 'visited';

export interface RibbonStage {
  status: ReflexStatus;
  state: RibbonState;
  /** Drawn beside the main path (Watch, Recompile, Deprecated, Retired). */
  satellite: boolean;
}

export interface ReturnArc {
  from: ReflexStatus;
  to: ReflexStatus;
  event: string;
  reason: string;
  at: string;
}

export interface Ribbon {
  current: ReflexStatus;
  stages: RibbonStage[];
  returns: ReturnArc[];
}

type TransitionLike = Pick<
  TransitionDto,
  'fromStatus' | 'toStatus' | 'event' | 'reason' | 'createdAt'
>;

export function buildRibbon(
  current: ReflexStatus,
  transitions: readonly TransitionLike[] | undefined,
): Ribbon {
  const known = transitions !== undefined && transitions.length > 0;
  const visited = new Set<ReflexStatus>(['candidate', current]);
  if (known) {
    for (const t of transitions) {
      visited.add(t.fromStatus);
      visited.add(t.toStatus);
    }
  } else {
    // Without a history, assume the main path up to the current stage was walked.
    for (const status of MAIN_PATH) if (rankOf(status) < rankOf(current)) visited.add(status);
    if (current === 'watch') visited.add('active');
  }

  const stateOf = (status: ReflexStatus): RibbonState => {
    if (status === current) return 'current';
    if (!visited.has(status)) return 'upcoming';
    return rankOf(status) < rankOf(current) ? 'done' : 'visited';
  };

  const stages: RibbonStage[] = MAIN_PATH.map((status) => ({
    status,
    state: stateOf(status),
    satellite: false,
  }));
  stages.push({ status: 'watch', state: stateOf('watch'), satellite: true });
  for (const off of ['recompile', 'deprecated', 'retired'] as const) {
    if (current === off || (known && visited.has(off))) {
      stages.push({ status: off, state: stateOf(off), satellite: true });
    }
  }

  const returns: ReturnArc[] = (transitions ?? [])
    .filter(
      (t) => rankOf(t.fromStatus) > rankOf(t.toStatus) && rankOf(t.toStatus) <= rankOf('active'),
    )
    .map((t) => ({
      from: t.fromStatus,
      to: t.toStatus,
      event: t.event,
      reason: t.reason,
      at: t.createdAt,
    }));

  return { current, stages, returns };
}

/** One sentence on what the stage means and what normally happens next. */
export const STAGE_BLURB: Record<ReflexStatus, string> = {
  candidate:
    'Compiled from traces. It cannot run live. Next: replay it against the traces it came from.',
  replay:
    'Re-executing the recorded tasks in the sandbox. It becomes Shadow when every trace reproduces.',
  shadow:
    'Running beside the baseline agent on held-out tasks. When the evidence gate passes it waits for a human.',
  approval: 'The evidence gate passed. A reviewer decides whether it may run live.',
  active: 'Promoted by a human. Known steps run locally; unknown steps cross the Token Firewall.',
  watch:
    'Trust is slipping. It still runs, under closer observation, and returns to Shadow if drift is confirmed.',
  recompile: 'Persistent disagreement: a new version must be compiled before it can run again.',
  deprecated: 'Superseded, rejected or rolled back. It will not run.',
  retired: 'End of life.',
};

/** Why the transition happened, in words, for the ribbon's return arcs and the timeline. */
export const EVENT_LABEL: Record<string, string> = {
  replay_started: 'Replay started',
  replay_passed: 'Replay passed',
  replay_failed: 'Replay failed',
  gate_passed: 'Evidence gate passed',
  approved: 'Approved by a reviewer',
  rejected: 'Rejected by a reviewer',
  trust_declined: 'Trust declined',
  trust_recovered: 'Trust recovered',
  drift_confirmed: 'Drift confirmed',
  persistent_disagreement: 'Persistent disagreement',
  recompiled: 'Recompiled',
  rolled_back: 'Rolled back by a reviewer',
  deprecated: 'Deprecated',
  retired: 'Retired',
};

export const eventLabel = (event: string): string =>
  EVENT_LABEL[event] ?? event.replaceAll('_', ' ');

export interface TransitionRule {
  from: ReflexStatus;
  event: string;
  to: ReflexStatus;
  /** Only a reviewer or admin can trigger it. */
  human: boolean;
}

/** The state machine, mirrored from packages/core/src/lifecycle.ts for display. The server enforces it. */
export const TRANSITION_RULES: readonly TransitionRule[] = [
  { from: 'candidate', event: 'replay_started', to: 'replay', human: false },
  { from: 'candidate', event: 'deprecated', to: 'deprecated', human: false },
  { from: 'replay', event: 'replay_passed', to: 'shadow', human: false },
  { from: 'replay', event: 'replay_failed', to: 'candidate', human: false },
  { from: 'shadow', event: 'gate_passed', to: 'approval', human: false },
  { from: 'shadow', event: 'persistent_disagreement', to: 'recompile', human: false },
  { from: 'approval', event: 'approved', to: 'active', human: true },
  { from: 'approval', event: 'rejected', to: 'shadow', human: true },
  { from: 'active', event: 'trust_declined', to: 'watch', human: false },
  { from: 'active', event: 'drift_confirmed', to: 'shadow', human: false },
  { from: 'active', event: 'rolled_back', to: 'deprecated', human: true },
  { from: 'watch', event: 'trust_recovered', to: 'active', human: false },
  { from: 'watch', event: 'drift_confirmed', to: 'shadow', human: false },
  { from: 'recompile', event: 'recompiled', to: 'shadow', human: false },
  { from: 'deprecated', event: 'retired', to: 'retired', human: false },
];

/** What can happen next from a status. */
export function nextRules(status: ReflexStatus): TransitionRule[] {
  return TRANSITION_RULES.filter((rule) => rule.from === status);
}
