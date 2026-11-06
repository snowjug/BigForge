import type {
  AuditEventDto,
  DriftCheckDto,
  DriftVerdict,
  EnvironmentDto,
  MutationDiff,
  MutationDto,
  ReflexStatus,
  ReflexStep,
  TransitionDto,
} from '@bigforge/schemas';
import type { NodeState } from '../../viz/forge-graph/types';

/* -------------------------------------------------------------------------------------------------
 * Environment: the synthetic toolchain
 * ----------------------------------------------------------------------------------------------- */

/** Numeric dotted-version comparison ("1.10.0" > "1.9.2"). */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

/** The version "Update the build tool" moves to: the newest one, unless the lab is already on it. */
export function updateTarget(environment: EnvironmentDto): string | null {
  const newest = [...environment.available].sort((a, b) =>
    compareVersions(b.version, a.version),
  )[0];
  if (!newest) return null;
  return compareVersions(newest.version, environment.toolchainVersion) > 0 ? newest.version : null;
}

/** The older versions the lab can be put back on, newest first. */
export function revertTargets(environment: EnvironmentDto): string[] {
  return environment.available
    .map((entry) => entry.version)
    .filter((version) => compareVersions(version, environment.toolchainVersion) < 0)
    .sort((a, b) => compareVersions(b, a));
}

export const versionDiff = (from: string, to: string): string => `forge-ci ${from} \u2192 ${to}`;

export interface EnvChange {
  id: string;
  at: string;
  by: string;
  from: string;
  to: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

/** Environment changes recorded in the audit log (`lab.environment_changed`), oldest first. */
export function environmentChanges(events: readonly AuditEventDto[]): EnvChange[] {
  const changes: EnvChange[] = [];
  for (const event of events) {
    if (event.action !== 'lab.environment_changed' || !isRecord(event.details)) continue;
    const { from, to } = event.details;
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    changes.push({ id: event.id, at: event.createdAt, by: event.actor, from, to });
  }
  return changes.sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** Why the "Update the build tool" action is unavailable, or null when it is available. */
export function updateToolBlocker(input: {
  canChange: boolean;
  target: string | null;
  current: string;
}): string | null {
  if (!input.canChange) return 'Changing the environment needs the operator role or higher.';
  if (input.target === null) return `Already on the newest build tool (forge-ci ${input.current}).`;
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * The canary: one row per familiar task
 * ----------------------------------------------------------------------------------------------- */

export interface CanaryRow {
  id: string;
  scenarioId: string;
  variantKey: string;
  fault: string;
  workspace: string;
  agree: boolean;
  divergenceStep: string | null;
  reflexStatus: string;
  stopReason: string | null;
  comparisonId: string;
}

/** "missing_export@packages/telemetry" becomes a fault ("missing export") and a workspace. */
export function splitVariant(variantKey: string): { fault: string; workspace: string } {
  const [fault = variantKey, workspace = ''] = variantKey.split('@');
  return { fault: fault.replaceAll('_', ' '), workspace };
}

export function canaryRows(check: DriftCheckDto): CanaryRow[] {
  return check.detail.pairs.map((pair) => ({
    id: pair.comparisonId,
    scenarioId: pair.scenarioId,
    variantKey: pair.variantKey,
    ...splitVariant(pair.variantKey),
    agree: pair.agree,
    divergenceStep: pair.divergenceStep,
    reflexStatus: pair.reflexStatus,
    stopReason: pair.stopReason,
    comparisonId: pair.comparisonId,
  }));
}

export interface HistogramBar {
  stepId: string | null;
  count: number;
  /** count / sample */
  share: number;
}

/** First divergence by step, most frequent first, with each step's share of the sample. */
export function divergenceHistogram(check: DriftCheckDto): HistogramBar[] {
  const sample = check.detail.sample;
  return [...check.detail.firstDivergence]
    .sort((a, b) => b.count - a.count)
    .map((entry) => ({
      stepId: entry.stepId,
      count: entry.count,
      share: sample > 0 ? entry.count / sample : 0,
    }));
}

export function agreementCounts(check: DriftCheckDto): {
  agree: number;
  disagree: number;
  total: number;
} {
  const agree = check.detail.pairs.filter((pair) => pair.agree).length;
  return { agree, disagree: check.detail.pairs.length - agree, total: check.detail.pairs.length };
}

/** "stop_condition: steps.decide.output.candidate_count == 0" in words; unknown shapes are returned as they are. */
export function describeStopReason(stopReason: string | null, reflexStatus: string): string {
  if (!stopReason) return reflexStatus === 'success' ? 'Completed and verified' : reflexStatus;
  const match = /^stop_condition:\s*steps\.([a-z0-9_]+)\.output\.(.+)$/i.exec(stopReason);
  if (match) return `Stopped safely by the guard on step "${match[1]}": ${match[2]}`;
  return stopReason;
}

/* -------------------------------------------------------------------------------------------------
 * The fracture: which step diverged and the assumption behind it
 * ----------------------------------------------------------------------------------------------- */

export function pickFracture(
  check: DriftCheckDto | null,
): { stepId: string; count: number; sample: number } | null {
  if (!check) return null;
  const top = [...check.detail.firstDivergence]
    .filter((entry): entry is { stepId: string; count: number } => entry.stepId !== null)
    .sort((a, b) => b.count - a.count)[0];
  return top ? { stepId: top.stepId, count: top.count, sample: check.detail.sample } : null;
}

/** Compiler assumptions that mention a step (they start with `Step "<id>":`). */
export function stepAssumptions(assumptions: readonly string[], stepId: string): string[] {
  const prefix = `Step "${stepId}"`;
  return assumptions.filter((text) => text.startsWith(prefix));
}

/** The clause that states the assumption ("assumes the log lists ... before ..."), else the last sentence. */
export function assumptionClause(text: string): string {
  const clause = /\bassumes?\b[^.;]*/i.exec(text);
  if (clause) return clause[0].trim();
  const sentences = text.split(/\.\s+/).filter(Boolean);
  return (sentences[sentences.length - 1] ?? text).replace(/\.$/, '').trim();
}

/** All steps reachable from `stepId` through `dependsOn` in the downstream direction. */
export function downstreamOf(steps: readonly ReflexStep[], stepId: string): Set<string> {
  const out = new Set<string>();
  const queue = [stepId];
  while (queue.length > 0) {
    const current = queue.pop();
    for (const step of steps) {
      if (step.dependsOn.includes(current ?? '') && !out.has(step.id)) {
        out.add(step.id);
        queue.push(step.id);
      }
    }
  }
  return out;
}

/** Upstream steps are cooled (done), the fractured step is stopped, everything downstream is left idle (and dimmed). */
export function fractureStates(
  steps: readonly ReflexStep[],
  stepId: string,
): Record<string, NodeState> {
  const downstream = downstreamOf(steps, stepId);
  const states: Record<string, NodeState> = {};
  for (const step of steps) {
    if (step.id === stepId) states[step.id] = 'stopped';
    else if (!downstream.has(step.id)) states[step.id] = 'done';
  }
  return states;
}

export interface FractureInfo {
  stepId: string;
  stepTitle: string;
  count: number;
  sample: number;
  /** Short label drawn on the graph. */
  label: string;
  headline: string;
  assumption: string | null;
  /** What the first disagreeing canary comparison says diverged. */
  detail: string | null;
  /** The environment version's description: why the assumption stopped holding. */
  cause: string | null;
  /** Where the Reflex actually stopped, when that is a later step. */
  stoppedAt: string | null;
}

export function describeFracture(input: {
  check: DriftCheckDto | null;
  steps: readonly ReflexStep[];
  assumptions: readonly string[];
  /** Divergence detail strings of disagreeing canary comparisons. */
  details?: readonly string[];
  environment?: EnvironmentDto | null;
}): FractureInfo | null {
  const top = pickFracture(input.check);
  if (!top) return null;
  const step = input.steps.find((candidate) => candidate.id === top.stepId);
  const stepTitle = step?.title ?? top.stepId;
  const assumption = stepAssumptions(input.assumptions, top.stepId)[0] ?? null;
  const stopped = input.check?.detail.pairs
    .map((pair) => /steps\.([a-z0-9_]+)\./i.exec(pair.stopReason ?? '')?.[1])
    .find((stopStep): stopStep is string => Boolean(stopStep) && stopStep !== top.stepId);
  const environment = input.environment;
  const cause =
    environment?.available.find((entry) => entry.version === environment.toolchainVersion)
      ?.description ?? null;
  return {
    stepId: top.stepId,
    stepTitle,
    count: top.count,
    sample: top.sample,
    label: `diverged in ${top.count} of ${top.sample}`,
    headline: `"${stepTitle}" diverged in ${top.count} of ${top.sample} canary tasks`,
    assumption: assumption ? assumptionClause(assumption) : null,
    detail: input.details?.[0] ?? null,
    cause,
    stoppedAt: stopped ? (input.steps.find((s) => s.id === stopped)?.title ?? stopped) : null,
  };
}

/* -------------------------------------------------------------------------------------------------
 * The verdict and the confidence that falls
 * ----------------------------------------------------------------------------------------------- */

export type DriftStatus = 'none' | 'drift' | 'ok' | 'insufficient';

export function driftStatus(
  verdict: DriftVerdict | null,
  config: { minSamples: number },
): DriftStatus {
  if (!verdict) return 'none';
  if (verdict.drift) return 'drift';
  return verdict.samples < config.minSamples ? 'insufficient' : 'ok';
}

export const DRIFT_STATUS_TEXT: Record<
  DriftStatus,
  { headline: string; tone: 'crimson' | 'jade' | 'amber' | 'ash' }
> = {
  none: { headline: 'No canary yet', tone: 'ash' },
  drift: { headline: 'Drift confirmed', tone: 'crimson' },
  ok: { headline: 'Within tolerance', tone: 'jade' },
  insufficient: { headline: 'Too few samples to confirm', tone: 'amber' },
};

export interface ConfidenceFall {
  before: number | null;
  after: number;
  /** after - before, in points (0..1 scale), null without a before. */
  delta: number | null;
  fell: boolean;
  belowWatch: boolean;
}

export function confidenceFall(
  check: DriftCheckDto | null,
  currentConfidence: number,
  watchBelow: number,
): ConfidenceFall {
  const before = check?.detail.before.confidence ?? null;
  const after = check?.detail.after.confidence ?? currentConfidence;
  return {
    before,
    after,
    delta: before === null ? null : after - before,
    fell: before !== null && after < before,
    belowWatch: after < watchBelow,
  };
}

/* -------------------------------------------------------------------------------------------------
 * The lifecycle ribbon: Active, Watch, Shadow
 * ----------------------------------------------------------------------------------------------- */

export const STATUS_LABEL: Record<ReflexStatus, string> = {
  candidate: 'Candidate',
  replay: 'Replay',
  shadow: 'Shadow',
  approval: 'Awaiting approval',
  active: 'Active',
  watch: 'Watch',
  recompile: 'Recompile',
  deprecated: 'Deprecated',
  retired: 'Retired',
};

export interface RibbonStage {
  status: ReflexStatus;
  label: string;
  position: 'passed' | 'current';
}

export interface RibbonLink {
  from: ReflexStatus;
  to: ReflexStatus;
  event: string;
  reason: string;
  actor: string | null;
  at: string | null;
  /** The system moved it, not a person (the safe direction needs no human). */
  automatic: boolean;
}

export function lifecycleRibbon(
  check: DriftCheckDto | null,
  versionTransitions: readonly TransitionDto[],
  currentStatus: ReflexStatus,
): { stages: RibbonStage[]; links: RibbonLink[] } {
  const steps = check?.detail.transitions ?? [];
  const first = steps[0];
  if (!first) {
    return {
      stages: [{ status: currentStatus, label: STATUS_LABEL[currentStatus], position: 'current' }],
      links: [],
    };
  }
  const path: ReflexStatus[] = [first.from, ...steps.map((step) => step.to)];
  const stages = path.map<RibbonStage>((status, index) => ({
    status,
    label: STATUS_LABEL[status],
    position: index === path.length - 1 ? 'current' : 'passed',
  }));
  const links = steps.map<RibbonLink>((step) => {
    const match = versionTransitions.find(
      (candidate) => candidate.event === step.event && candidate.reason === step.reason,
    );
    const actor = match?.actor ?? null;
    return {
      from: step.from,
      to: step.to,
      event: step.event,
      reason: step.reason,
      actor,
      at: match?.createdAt ?? null,
      automatic: actor === null ? true : /^bigforge\b/i.test(actor),
    };
  });
  return { stages, links };
}

/* -------------------------------------------------------------------------------------------------
 * The mutation proposal
 * ----------------------------------------------------------------------------------------------- */

/** "local.locate_by_log_order@1.0.0" as a readable pair, or null for anything else. */
export function parseOperator(ref: string | null): { name: string; version: string } | null {
  if (!ref) return null;
  const match = /^local\.([a-z0-9_]+)@(\d+\.\d+\.\d+)$/.exec(ref);
  return match && match[1] && match[2] ? { name: match[1], version: match[2] } : null;
}

export function describeStepChange(change: MutationDiff['steps'][number]): string {
  const from = parseOperator(change.from)?.name ?? change.from ?? 'nothing';
  const to = parseOperator(change.to)?.name ?? change.to ?? 'nothing';
  if (change.change === 'operator') return `swaps ${from} for ${to}`;
  if (change.change === 'added') return `adds ${to}`;
  return `removes ${from}`;
}

export interface RegressionSummary {
  runs: number;
  agreements: number;
  /** 0..1, null when no trace was replayed. */
  ratio: number | null;
  allAgree: boolean;
  groups: { env: string; agree: number; total: number }[];
}

export function regressionSummary(evidence: MutationDto['evidence']): RegressionSummary {
  const { regression } = evidence;
  const byEnv = new Map<string, { agree: number; total: number }>();
  for (const item of regression.items) {
    const group = byEnv.get(item.env) ?? { agree: 0, total: 0 };
    group.total += 1;
    if (item.agree) group.agree += 1;
    byEnv.set(item.env, group);
  }
  return {
    runs: regression.runs,
    agreements: regression.agreements,
    ratio: regression.agreement,
    allAgree: regression.runs > 0 && regression.agreements === regression.runs,
    groups: [...byEnv.entries()]
      .sort(([a], [b]) => compareVersions(a, b))
      .map(([env, group]) => ({ env, ...group })),
  };
}

export interface MutationStatusInfo {
  label: string;
  tone: 'ember' | 'jade' | 'ash';
  /** The unmissable statement about activation. */
  words: string;
}

export function mutationStatusInfo(mutation: MutationDto): MutationStatusInfo {
  switch (mutation.status) {
    case 'proposed':
      return {
        label: 'Proposed',
        tone: 'ember',
        words: `Proposed, not activated. v${mutation.toVersion} cannot run until a reviewer approves it, and then it only enters shadow validation.`,
      };
    case 'approved':
      return {
        label: 'Approved',
        tone: 'jade',
        words: `Approved by a reviewer: v${mutation.toVersion} entered shadow validation. It is still not active. It must earn trust in shadow and be promoted.`,
      };
    default:
      return {
        label: 'Rejected',
        tone: 'ash',
        words: `Rejected: v${mutation.toVersion} was deprecated. Nothing changed for the running Reflex.`,
      };
  }
}

/** Why Propose is unavailable, or null. */
export function proposeBlocker(input: {
  canPropose: boolean;
  status: ReflexStatus | null;
  hasCheck: boolean;
  hasProposed: boolean;
}): string | null {
  if (!input.status) return 'There is no Reflex to mutate yet.';
  if (!input.canPropose) return 'Proposing a mutation needs the operator role or higher.';
  if (input.status !== 'shadow' && input.status !== 'watch') {
    return `A mutation is proposed for a Reflex in shadow or watch. This one is ${input.status}.`;
  }
  if (!input.hasCheck) {
    return 'Run the Drift Canary first: a mutation learns from the tasks the baseline solved after the change.';
  }
  if (input.hasProposed) return 'A mutation is already proposed for this version.';
  return null;
}

/** Why Approve or Reject is unavailable, or null. */
export function decisionBlocker(input: {
  kind: 'approve' | 'reject';
  canDecide: boolean;
  role: string | null;
  mutation: MutationDto;
}): string | null {
  if (!input.canDecide) {
    return `Only a reviewer or admin can decide a mutation${input.role ? ` (you are signed in as ${input.role})` : ''}.`;
  }
  if (input.mutation.status !== 'proposed')
    return `This mutation is already ${input.mutation.status}.`;
  const regression = regressionSummary(input.mutation.evidence);
  if (input.kind === 'approve' && !regression.allAgree) {
    return `Regression replay reproduced ${regression.agreements} of ${regression.runs} traces. All must reproduce before approval.`;
  }
  return null;
}

/** Why Run the Drift Canary is unavailable, or null. */
export function canaryBlocker(input: {
  hasVersion: boolean;
  canRun: boolean;
  status: ReflexStatus | null;
}): string | null {
  if (!input.hasVersion || !input.status) return 'There is no Reflex to monitor yet.';
  if (!input.canRun) return 'Running the canary needs the operator role or higher.';
  if (input.status !== 'active' && input.status !== 'watch') {
    return `The canary monitors active Reflexes. This one is ${input.status}${input.status === 'shadow' ? ': it is back in validation and cannot run live' : ''}.`;
  }
  return null;
}

/* -------------------------------------------------------------------------------------------------
 * The story strip: where the demo's drift scenario stands
 * ----------------------------------------------------------------------------------------------- */

export type StageId = 'environment' | 'canary' | 'confidence' | 'lifecycle' | 'mutation';
export type StageState = 'done' | 'alert' | 'pending';

export interface StorySummary {
  id: StageId;
  label: string;
  state: StageState;
  note: string;
}

export function storyStages(input: {
  environmentChange: { from: string; to: string } | null;
  status: DriftStatus;
  confidence: ConfidenceFall;
  demoted: boolean;
  mutation: MutationDto | null;
}): StorySummary[] {
  const { environmentChange, status, confidence, demoted, mutation } = input;
  return [
    {
      id: 'environment',
      label: 'World changes',
      state: environmentChange ? 'done' : 'pending',
      note: environmentChange
        ? versionDiff(environmentChange.from, environmentChange.to)
        : 'unchanged',
    },
    {
      id: 'canary',
      label: 'Canary',
      state: status === 'drift' ? 'alert' : status === 'none' ? 'pending' : 'done',
      note: DRIFT_STATUS_TEXT[status].headline.toLowerCase(),
    },
    {
      id: 'confidence',
      label: 'Confidence',
      state: confidence.fell ? 'alert' : status === 'none' ? 'pending' : 'done',
      note: confidence.fell ? 'falls' : 'holds',
    },
    {
      id: 'lifecycle',
      label: 'Back to Shadow',
      state: demoted ? 'alert' : 'pending',
      note: demoted ? 'automatic' : 'not triggered',
    },
    {
      id: 'mutation',
      label: 'Mutation',
      state: mutation ? (mutation.status === 'proposed' ? 'alert' : 'done') : 'pending',
      note: mutation ? mutation.status : 'none',
    },
  ];
}
