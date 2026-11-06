import type {
  Comparison,
  ComparisonCheck,
  Divergence,
  FileChangeLike,
  RunDigest,
  Trace,
} from '@bigforge/schemas';
import type { ExecutionResult } from './executor';

/** What a run produced, reduced to the facts that matter for comparing two executions. */
const patchKey = (changes: FileChangeLike[]): string =>
  JSON.stringify(
    [...changes].sort((a, b) => a.file.localeCompare(b.file)).map((c) => [c.file, c.after]),
  );

/**
 * Agreement between a reference execution (the baseline agent) and a Reflex on the same task:
 * same outcome, both verified, same root cause, same patch, and no safety violation by the Reflex.
 * A safety violation disqualifies a Reflex regardless of any other agreement.
 */
export function compareRuns(baseline: RunDigest, reflex: RunDigest): Comparison {
  const root = (r: RunDigest) =>
    r.rootFailure ? `${r.rootFailure.code} in ${r.rootFailure.workspace}` : 'none';
  const checks: ComparisonCheck[] = [
    {
      id: 'outcome',
      label: 'Outcome',
      baseline: baseline.status,
      reflex:
        reflex.status === 'stopped' ? `stopped (${reflex.stopReason ?? 'unknown'})` : reflex.status,
      match: baseline.status === reflex.status,
    },
    {
      id: 'verification',
      label: 'Independent verification',
      baseline: baseline.verification,
      reflex: reflex.verification,
      match: baseline.verification === reflex.verification && reflex.verification === 'pass',
    },
    {
      id: 'root_cause',
      label: 'Root cause',
      baseline: root(baseline),
      reflex: root(reflex),
      match: root(baseline) === root(reflex) && baseline.rootFailure !== null,
    },
    {
      id: 'patch',
      label: 'Final file contents',
      baseline: baseline.changes.map((c) => c.file).join(', ') || 'no changes',
      reflex: reflex.changes.map((c) => c.file).join(', ') || 'no changes',
      match: patchKey(baseline.changes) === patchKey(reflex.changes),
    },
    {
      id: 'safety',
      label: 'Safety violations by the Reflex',
      baseline: String(baseline.safetyViolations),
      reflex: String(reflex.safetyViolations),
      match: reflex.safetyViolations === 0,
    },
  ];
  const agree = checks.every((c) => c.match);
  return {
    agree,
    checks,
    divergence: findDivergence(baseline, reflex),
    deltas: {
      modelCalls: reflex.usage.modelCalls - baseline.usage.modelCalls,
      tokens: reflex.usage.totalTokens - baseline.usage.totalTokens,
      costUsd: reflex.usage.costUsd - baseline.usage.costUsd,
      commands: reflex.usage.commands - baseline.usage.commands,
      modelLatencyMs: reflex.usage.modelLatencyMs - baseline.usage.modelLatencyMs,
      localMs: reflex.usage.localMs - baseline.usage.localMs,
    },
  };
}

/** The earliest point at which the Reflex's behaviour departs from the reference execution. */
export function findDivergence(baseline: RunDigest, reflex: RunDigest): Divergence {
  const b = baseline.rootFailure;
  const r = reflex.rootFailure;
  if (b && r && (b.workspace !== r.workspace || b.code !== r.code)) {
    return {
      stepId: 'locate',
      kind: 'root_cause',
      detail: `The Reflex located ${r.code} in ${r.workspace}; the reference found ${b.code} in ${b.workspace}`,
    };
  }
  if (reflex.status === 'stopped') {
    return {
      stepId: reflex.stopStepId,
      kind: 'stopped',
      detail: reflex.stopReason ?? 'The Reflex stopped',
    };
  }
  if (patchKey(baseline.changes) !== patchKey(reflex.changes)) {
    return {
      stepId: 'decide',
      kind: 'remedy',
      detail: 'The Reflex applied a different change than the reference',
    };
  }
  if (baseline.verification !== reflex.verification) {
    return {
      stepId: 'verify',
      kind: 'verification',
      detail: `Verification differs: reference ${baseline.verification}, Reflex ${reflex.verification}`,
    };
  }
  return { stepId: null, kind: 'none', detail: 'No divergence' };
}

export function digestOf(args: {
  runId: string;
  trace: Trace;
  changes: FileChangeLike[];
  execution: ExecutionResult | null;
}): RunDigest {
  const { trace, execution } = args;
  return {
    runId: args.runId,
    traceId: trace.id,
    kind: trace.runKind,
    status: trace.outcome.status,
    verification: trace.verification.status,
    rootFailure: trace.outcome.rootFailure,
    changes: args.changes.map((c) => ({ file: c.file, after: c.after })),
    usage: trace.usage,
    stopReason: execution?.stopReason ?? null,
    stopStepId: execution?.stopStepId ?? null,
    safetyViolations: trace.agent.kind === 'reflex' ? trace.usage.blockedActions : 0,
  };
}
