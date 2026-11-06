import type { GateCheck, GateResult, PromotionGate, ReflexStatus } from '@bigforge/schemas';

export type LifecycleEvent =
  | 'replay_started'
  | 'replay_passed'
  | 'replay_failed'
  | 'gate_passed'
  | 'approved'
  | 'rejected'
  | 'trust_declined'
  | 'trust_recovered'
  | 'drift_confirmed'
  | 'persistent_disagreement'
  | 'recompiled'
  | 'rolled_back'
  | 'deprecated'
  | 'retired';

const TRANSITIONS: Record<ReflexStatus, Partial<Record<LifecycleEvent, ReflexStatus>>> = {
  candidate: { replay_started: 'replay', deprecated: 'deprecated' },
  replay: { replay_passed: 'shadow', replay_failed: 'candidate' },
  shadow: {
    gate_passed: 'approval',
    persistent_disagreement: 'recompile',
    deprecated: 'deprecated',
  },
  approval: { approved: 'active', rejected: 'shadow', deprecated: 'deprecated' },
  active: {
    trust_declined: 'watch',
    drift_confirmed: 'shadow',
    rolled_back: 'deprecated',
    deprecated: 'deprecated',
  },
  watch: { trust_recovered: 'active', drift_confirmed: 'shadow', deprecated: 'deprecated' },
  recompile: { recompiled: 'shadow', deprecated: 'deprecated' },
  deprecated: { retired: 'retired' },
  retired: {},
};

export class InvalidTransitionError extends Error {
  readonly from: ReflexStatus;
  readonly event: LifecycleEvent;
  constructor(from: ReflexStatus, event: LifecycleEvent) {
    super(`Invalid lifecycle transition: "${event}" is not allowed from "${from}"`);
    this.name = 'InvalidTransitionError';
    this.from = from;
    this.event = event;
  }
}

/** The Reflex lifecycle state machine. Trust is earned and can expire; there is no path around approval. */
export function transition(from: ReflexStatus, event: LifecycleEvent): ReflexStatus {
  const to = TRANSITIONS[from][event];
  if (!to) throw new InvalidTransitionError(from, event);
  return to;
}

export function allowedEvents(from: ReflexStatus): LifecycleEvent[] {
  return Object.keys(TRANSITIONS[from]) as LifecycleEvent[];
}

/** Statuses in which a Reflex may execute work that is applied (production-like use). */
export function mayExecuteActive(status: ReflexStatus): boolean {
  return status === 'active' || status === 'watch';
}

/** Statuses in which a Reflex may run beside the baseline for comparison. */
export function mayRunInShadow(status: ReflexStatus): boolean {
  return (
    status === 'candidate' ||
    status === 'replay' ||
    status === 'shadow' ||
    status === 'approval' ||
    status === 'recompile'
  );
}

export interface GateEvidence {
  shadowRuns: number;
  distinctVariants: number;
  safetyViolations: number;
  agreement: number;
  replayAgreement: number;
  replayRuns: number;
}

/** Server-enforced promotion eligibility. Example thresholds (configurable, not validated). */
export function evaluateGate(evidence: GateEvidence, gate: PromotionGate): GateResult {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const checks: GateCheck[] = [
    {
      id: 'replay',
      label: 'Historical replay agreement',
      required: `${pct(gate.minReplayAgreement)} on at least 1 trace`,
      actual: `${pct(evidence.replayAgreement)} over ${evidence.replayRuns} trace(s)`,
      passed: evidence.replayRuns > 0 && evidence.replayAgreement >= gate.minReplayAgreement,
    },
    {
      id: 'shadow_runs',
      label: 'Shadow runs',
      required: `at least ${gate.minShadowRuns}`,
      actual: String(evidence.shadowRuns),
      passed: evidence.shadowRuns >= gate.minShadowRuns,
    },
    {
      id: 'variants',
      label: 'Distinct variants in shadow',
      required: `at least ${gate.minDistinctVariants}`,
      actual: String(evidence.distinctVariants),
      passed: evidence.distinctVariants >= gate.minDistinctVariants,
    },
    {
      id: 'safety',
      label: 'Safety violations',
      required: `at most ${gate.maxSafetyViolations}`,
      actual: String(evidence.safetyViolations),
      passed: evidence.safetyViolations <= gate.maxSafetyViolations,
    },
    {
      id: 'agreement',
      label: 'Shadow agreement with the baseline',
      required: `at least ${pct(gate.minAgreement)}`,
      actual: pct(evidence.agreement),
      passed: evidence.shadowRuns > 0 && evidence.agreement >= gate.minAgreement,
    },
  ];
  return { eligible: checks.every((c) => c.passed), checks };
}
