import type { Provenance, RunKind, Trace } from '@bigforge/schemas';

/**
 * "Is this trace safe to learn from?" Derived from real recorded fields and from the rule the compiler
 * itself uses (packages/platform learning.sourceRuns): a verified, successful, standalone baseline run.
 * Nothing here is invented: every check names the field it read.
 */

export type CheckStatus = 'pass' | 'fail' | 'warn' | 'info';

export interface LearnCheck {
  id: string;
  question: string;
  status: CheckStatus;
  answer: string;
  /** The recorded field the answer was read from. */
  field: string;
}

export interface BlockedAction {
  seq: number;
  action: string;
  rule: string;
  reason: string;
  purpose: string | null;
}

export interface CompileInfo {
  reflexName: string;
  version: string;
  sourceTraceIds: readonly string[];
  excluded: readonly { purpose: string; occurrences: number; reason: string }[];
}

export type Verdict = 'safe' | 'safe_with_exclusions' | 'not_safe' | 'not_a_source';

export interface ProvenanceRow {
  figure: string;
  value: 'tokens' | 'cost' | 'model_latency' | 'local_time' | 'commands' | 'blocked';
  provenance: Provenance[];
  note: string;
}

export interface LearnAssessment {
  verdict: Verdict;
  headline: string;
  summary: string;
  checks: LearnCheck[];
  blocked: BlockedAction[];
  /** Blocked actions whose purpose the compile report lists as an excluded behaviour. */
  excludedConfirmed: { purpose: string; occurrences: number; reason: string }[];
  provenance: ProvenanceRow[];
  redactionMarkers: number;
}

export interface AssessInput {
  trace: Trace;
  kind: RunKind;
  groupId: string | null;
  /** The Reflex compiled from this task family, when the registry has one. */
  compile: CompileInfo | null;
  /** The toolchain the lab runs now (to flag a trace recorded under an older one). */
  currentToolchain: string | null;
  /** Markers found in the recorded previews (the page counts them while building the timeline). */
  redactionMarkers: number;
}

export function blockedActionsOf(trace: Pick<Trace, 'events'>): BlockedAction[] {
  const out: BlockedAction[] = [];
  const matched = new Set<string>();
  for (const event of trace.events) {
    if (event.kind !== 'tool_call' || event.status !== 'blocked') continue;
    const action = commandOf(event.args, event.tool);
    const safety = trace.events.find(
      (other) =>
        other.kind === 'safety' &&
        other.blocked &&
        !matched.has(other.id) &&
        other.action === action,
    );
    if (safety) matched.add(safety.id);
    out.push({
      seq: event.seq,
      action,
      rule:
        safety && safety.kind === 'safety'
          ? safety.rule
          : (event.blockedReason?.split(':')[0] ?? 'blocked'),
      reason:
        safety && safety.kind === 'safety'
          ? safety.reason
          : (event.blockedReason ?? 'Blocked by the safety policy'),
      purpose: event.purpose ?? null,
    });
  }
  for (const event of trace.events) {
    if (event.kind === 'safety' && event.blocked && !matched.has(event.id)) {
      out.push({
        seq: event.seq,
        action: event.action,
        rule: event.rule,
        reason: event.reason,
        purpose: null,
      });
    }
  }
  return out.sort((a, b) => a.seq - b.seq);
}

function commandOf(args: Record<string, unknown>, tool: string): string {
  for (const key of ['command', 'path', 'file']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return tool;
}

const KIND_NAME: Record<RunKind, string> = {
  baseline: 'baseline agent',
  reflex: 'Reflex',
  shadow_baseline: 'shadow baseline',
  shadow_reflex: 'shadow Reflex',
  replay_reflex: 'replay Reflex',
  canary_baseline: 'canary baseline',
  canary_reflex: 'canary Reflex',
};

function provenanceOf(trace: Trace): ProvenanceRow[] {
  const usage = trace.usage;
  const tokenKinds = new Set<Provenance>();
  for (const event of trace.events)
    if (event.kind === 'model_call') tokenKinds.add(event.usage.provenance);
  if (tokenKinds.size === 0) tokenKinds.add(usage.tokenProvenance);
  return [
    {
      figure: 'Tokens',
      value: 'tokens',
      provenance: [...tokenKinds],
      note: 'Produced by the deterministic provider, a scripted stand-in for a model. Not the output of a real model.',
    },
    {
      figure: 'Model latency',
      value: 'model_latency',
      provenance: [usage.modelLatencyProvenance],
      note: 'Computed from a documented token-based model, not timed.',
    },
    {
      figure: 'Command time',
      value: 'local_time',
      provenance: [usage.localMsProvenance],
      note: 'Wall-clock time around each sandboxed process.',
    },
    {
      figure: 'Cost',
      value: 'cost',
      provenance: [usage.costProvenance],
      note: 'Tokens times a pinned price assumption, not a vendor price.',
    },
    {
      figure: 'Commands',
      value: 'commands',
      provenance: ['measured'],
      note: 'Counted from tool-call events that spawned a process.',
    },
  ];
}

export function assessTrace(input: AssessInput): LearnAssessment {
  const { trace, kind, groupId, compile } = input;
  const blocked = blockedActionsOf(trace);
  const failedRules = trace.verification.rules.filter((rule) => rule.status === 'fail');
  const passedRules = trace.verification.rules.filter((rule) => rule.status === 'pass');
  const excludedConfirmed = compile
    ? compile.excluded.filter((entry) => blocked.some((action) => action.purpose === entry.purpose))
    : [];
  const checks: LearnCheck[] = [];

  const isBaseline = kind === 'baseline';
  checks.push({
    id: 'source_kind',
    question: 'Is it a baseline agent run?',
    status: isBaseline ? 'pass' : 'info',
    answer: isBaseline
      ? 'Yes. The compiler learns from baseline agent runs only.'
      : `No, it is a ${KIND_NAME[kind]} run. That is output of a Reflex or a validation run, so it is never a source trace.`,
    field: 'run.kind',
  });

  const standalone = groupId === null;
  checks.push({
    id: 'standalone',
    question: 'Is it a standalone run?',
    status: standalone ? 'pass' : 'info',
    answer: standalone
      ? 'Yes. It was not made as a comparison reference or a fallback.'
      : 'No. It belongs to a group (a comparison reference, a fallback, or a shadow or canary pair), and the compiler skips those.',
    field: 'run.groupId',
  });

  const success = trace.outcome.status === 'success';
  checks.push({
    id: 'outcome',
    question: 'Did the agent finish the task?',
    status: success ? 'pass' : 'fail',
    answer: success
      ? 'Yes. The run ended in success.'
      : `No. The run ended as "${trace.outcome.status}".`,
    field: 'trace.outcome.status',
  });

  const verified = trace.verification.status === 'pass';
  checks.push({
    id: 'verification',
    question: 'Did an independent verifier confirm it?',
    status: verified ? 'pass' : 'fail',
    answer: verified
      ? `Yes. ${passedRules.length} of ${trace.verification.rules.length} rules passed (${trace.verification.verifier}).`
      : failedRules.length > 0
        ? `No. Failed: ${failedRules.map((rule) => rule.label).join('; ')}.`
        : `No. Verification is "${trace.verification.status}".`,
    field: 'trace.verification',
  });

  checks.push({
    id: 'blocked',
    question: 'Did it attempt anything the safety policy blocks?',
    status: blocked.length === 0 ? 'pass' : 'warn',
    answer:
      blocked.length === 0
        ? 'No blocked or destructive action was recorded.'
        : excludedConfirmed.length > 0
          ? `Yes, ${blocked.length} blocked. The compile report lists ${excludedConfirmed.map((entry) => `"${entry.purpose}"`).join(', ')} as an excluded behaviour: ${excludedConfirmed[0]?.reason ?? ''}`
          : `Yes, ${blocked.length} blocked. The trace keeps it as evidence; a call the policy blocked is never compiled into a step.`,
    field: 'events[kind=safety].blocked',
  });

  const applied = trace.redaction.applied;
  checks.push({
    id: 'redaction',
    question: 'Were secrets redacted before it was stored?',
    status: applied ? 'pass' : 'fail',
    answer: applied
      ? `Yes. ${trace.redaction.redactions} redaction${trace.redaction.redactions === 1 ? '' : 's'} applied${input.redactionMarkers > 0 ? `; ${input.redactionMarkers} marker${input.redactionMarkers === 1 ? '' : 's'} visible in the recorded previews` : ''}.`
      : 'No. Redaction was not applied to this trace.',
    field: 'trace.redaction',
  });

  const used = compile ? compile.sourceTraceIds.includes(trace.id) : false;
  checks.push({
    id: 'source_use',
    question: 'Has a Reflex learned from it?',
    status: 'info',
    answer: compile
      ? used
        ? `Yes. It is a source trace of ${compile.reflexName} v${compile.version}.`
        : `Not by ${compile.reflexName} v${compile.version}: its source list does not include this trace.`
      : 'No Reflex has been compiled for this family yet, or none is visible to you.',
    field: 'reflex.provenance.sourceTraceIds',
  });

  const recorded = trace.environment.toolchain.version;
  if (input.currentToolchain && input.currentToolchain !== recorded) {
    checks.push({
      id: 'environment',
      question: 'Does it match the toolchain in use now?',
      status: 'warn',
      answer: `Recorded on ${trace.environment.toolchain.name} ${recorded}; the lab now runs ${input.currentToolchain}. Behaviour can differ between versions.`,
      field: 'trace.environment.toolchain',
    });
  } else {
    checks.push({
      id: 'environment',
      question: 'Does it match the toolchain in use now?',
      status: input.currentToolchain ? 'pass' : 'info',
      answer: input.currentToolchain
        ? `Yes. Recorded on ${trace.environment.toolchain.name} ${recorded}, the version in use.`
        : `Recorded on ${trace.environment.toolchain.name} ${recorded}.`,
      field: 'trace.environment.toolchain',
    });
  }

  let verdict: Verdict;
  let headline: string;
  let summary: string;
  if (!isBaseline || !standalone) {
    verdict = 'not_a_source';
    headline = 'Not a source trace';
    summary = !isBaseline
      ? `The compiler learns only from baseline agent runs. This is a ${KIND_NAME[kind]} run.`
      : 'The compiler skips runs made as a comparison reference or a fallback.';
  } else if (!success || !verified || !applied) {
    verdict = 'not_safe';
    headline = 'Not safe to learn from';
    summary = !applied
      ? 'Secrets were not redacted, so this trace must not be learned from.'
      : 'Only independently verified successes may teach a Reflex.';
  } else if (blocked.length > 0) {
    verdict = 'safe_with_exclusions';
    headline = 'Safe to learn from, with exclusions';
    summary = `Verified success. ${blocked.length} blocked action${blocked.length === 1 ? '' : 's'} stay in the trace as excluded behaviour; they are never compiled.`;
  } else {
    verdict = 'safe';
    headline = 'Safe to learn from';
    summary = 'Verified success, no blocked actions, secrets redacted.';
  }

  return {
    verdict,
    headline,
    summary,
    checks,
    blocked,
    excludedConfirmed,
    provenance: provenanceOf(trace),
    redactionMarkers: input.redactionMarkers,
  };
}
