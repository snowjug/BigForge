import type { Provenance, Trace, TraceEvent, UsageSummary } from '@bigforge/schemas';

/**
 * Pure model of "Baseline vs Reflex synchronized execution".
 *
 * Both lanes are drawn on ONE virtual time axis. Virtual time is the trace's own `offsetMs` clock: the
 * deterministic provider's simulated model latency plus the measured duration of every local operation.
 * Nothing here reads the DOM or the clock.
 */

export type LaneSide = 'baseline' | 'reflex';

export interface ModelBlock {
  kind: 'model';
  id: string;
  seq: number;
  start: number;
  end: number;
  purpose: string | null;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  tokens: number;
  latencyMs: number;
  tokenProvenance: Provenance;
  latencyProvenance: Provenance;
  /** Set when the call crossed an uncertainty boundary. */
  boundaryStepId: string | null;
  preview: string;
}

export interface ToolBlock {
  kind: 'tool';
  id: string;
  seq: number;
  start: number;
  end: number;
  tool: string;
  purpose: string | null;
  /** The command, file or path the call acted on. */
  label: string;
  status: 'ok' | 'error' | 'blocked';
  spawned: boolean;
  durationMs: number;
  exitCode: number | null;
  blockedReason: string | null;
}

export interface StepBlock {
  kind: 'step';
  id: string;
  seq: number;
  start: number;
  end: number;
  stepId: string;
  operator: string;
  status: 'ok' | 'escalated' | 'stopped' | 'skipped';
  executor: 'local' | 'model';
  durationMs: number;
  summary: string;
}

export interface LaneMark {
  kind: 'mark';
  id: string;
  seq: number;
  at: number;
  type: 'decision' | 'safety' | 'note' | 'boundary';
  label: string;
  blocked: boolean;
}

export interface Lane {
  side: LaneSide;
  runId: string;
  label: string;
  models: ModelBlock[];
  tools: ToolBlock[];
  steps: StepBlock[];
  marks: LaneMark[];
  /** Virtual time at which the lane finishes. */
  end: number;
  usage: UsageSummary;
}

/** The part of a run detail the lane needs. `RunDetailDto` satisfies it. */
export interface LaneSource {
  id: string;
  trace: Pick<Trace, 'events' | 'agent'>;
  usage: UsageSummary;
}

export function toolLabel(tool: string, args: Record<string, unknown>): string {
  for (const key of ['command', 'path', 'file']) {
    const value = args[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return tool;
}

const finite = (value: number): number => (Number.isFinite(value) ? value : 0);

function blocksOf(events: readonly TraceEvent[]) {
  const models: ModelBlock[] = [];
  const tools: ToolBlock[] = [];
  const steps: StepBlock[] = [];
  const marks: LaneMark[] = [];
  for (const event of events) {
    const start = finite(event.offsetMs);
    switch (event.kind) {
      case 'model_call':
        models.push({
          kind: 'model',
          id: event.id,
          seq: event.seq,
          start,
          end: start + finite(event.latency.ms),
          purpose: event.purpose ?? null,
          model: event.provider.model,
          inputTokens: event.usage.inputTokens,
          outputTokens: event.usage.outputTokens,
          cachedInputTokens: event.usage.cachedInputTokens,
          tokens: event.usage.inputTokens + event.usage.outputTokens,
          latencyMs: finite(event.latency.ms),
          tokenProvenance: event.usage.provenance,
          latencyProvenance: event.latency.provenance,
          boundaryStepId: event.boundaryStepId ?? null,
          preview: event.responsePreview,
        });
        break;
      case 'tool_call':
        tools.push({
          kind: 'tool',
          id: event.id,
          seq: event.seq,
          start,
          end: start + finite(event.durationMs),
          tool: event.tool,
          purpose: event.purpose ?? null,
          label: toolLabel(event.tool, event.args),
          status: event.status,
          spawned: event.spawned,
          durationMs: finite(event.durationMs),
          exitCode: event.exitCode,
          blockedReason: event.blockedReason ?? null,
        });
        break;
      case 'step':
        steps.push({
          kind: 'step',
          id: event.id,
          seq: event.seq,
          start,
          end: start + finite(event.durationMs),
          stepId: event.stepId,
          operator: event.operator,
          status: event.status,
          executor: event.executor,
          durationMs: finite(event.durationMs),
          summary: event.summary,
        });
        break;
      case 'decision':
        marks.push({
          kind: 'mark',
          id: event.id,
          seq: event.seq,
          at: start,
          type: 'decision',
          label: event.intent,
          blocked: false,
        });
        break;
      case 'safety':
        marks.push({
          kind: 'mark',
          id: event.id,
          seq: event.seq,
          at: start,
          type: 'safety',
          label: event.action,
          blocked: event.blocked,
        });
        break;
      case 'note':
        marks.push({
          kind: 'mark',
          id: event.id,
          seq: event.seq,
          at: start,
          type: 'note',
          label: event.message,
          blocked: false,
        });
        break;
      case 'boundary':
        marks.push({
          kind: 'mark',
          id: event.id,
          seq: event.seq,
          at: start,
          type: 'boundary',
          label: event.stepId,
          blocked: false,
        });
        break;
    }
  }
  return { models, tools, steps, marks };
}

/** Builds one lane from a recorded trace. Blocks keep the trace's own (virtual) start offsets. */
export function buildLane(side: LaneSide, run: LaneSource): Lane {
  const { models, tools, steps, marks } = blocksOf(run.trace.events);
  const byStart = <T extends { start: number; seq: number }>(a: T, b: T) =>
    a.start - b.start || a.seq - b.seq;
  models.sort(byStart);
  tools.sort(byStart);
  steps.sort(byStart);
  marks.sort((a, b) => a.at - b.at || a.seq - b.seq);
  let end = 0;
  for (const block of [...models, ...tools, ...steps]) end = Math.max(end, block.end);
  for (const mark of marks) end = Math.max(end, mark.at);
  return {
    side,
    runId: run.id,
    label: run.trace.agent.name,
    models,
    tools,
    steps,
    marks,
    end,
    usage: run.usage,
  };
}

export interface Playback {
  /** Length of the shared time axis: the longest lane. */
  duration: number;
  lanes: Lane[];
}

export function buildPlayback(lanes: readonly Lane[]): Playback {
  return { duration: Math.max(1, ...lanes.map((lane) => lane.end)), lanes: [...lanes] };
}

export interface Counters {
  modelCalls: number;
  /** A model call is in flight at this instant. */
  modelCallActive: boolean;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  totalTokens: number;
  /** The run's cost split across calls by token share. Exact only at the end of the lane. */
  costUsd: number;
  commands: number;
  toolCalls: number;
  blockedActions: number;
  elapsedMs: number;
  /** The lane has finished at this instant. */
  finished: boolean;
}

/**
 * Live counters of one lane at virtual time `t`. A model call counts from the moment it is made. At the end
 * of the lane the figures equal the run's recorded usage (see the tests); cost is attributed to calls by
 * token share because the API reports one cost per run.
 */
export function countersAt(lane: Lane, t: number): Counters {
  const totalLaneTokens = lane.models.reduce((sum, block) => sum + block.tokens, 0);
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let allocatedTokens = 0;
  let modelCallActive = false;
  for (const block of lane.models) {
    if (block.start > t) continue;
    modelCalls += 1;
    inputTokens += block.inputTokens;
    outputTokens += block.outputTokens;
    cachedInputTokens += block.cachedInputTokens;
    allocatedTokens += block.tokens;
    if (t < block.end) modelCallActive = true;
  }
  let commands = 0;
  let toolCalls = 0;
  let blockedActions = 0;
  for (const block of lane.tools) {
    if (block.start > t) continue;
    toolCalls += 1;
    if (block.status === 'blocked') blockedActions += 1;
    else if (block.spawned) commands += 1;
  }
  const finished = t >= lane.end;
  return {
    modelCalls,
    modelCallActive,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens: inputTokens + outputTokens,
    costUsd: totalLaneTokens > 0 ? lane.usage.costUsd * (allocatedTokens / totalLaneTokens) : 0,
    commands,
    toolCalls,
    blockedActions,
    elapsedMs: Math.min(Math.max(t, 0), lane.end),
    finished,
  };
}

export type ActiveWork =
  | { type: 'model'; block: ModelBlock }
  | { type: 'step'; block: StepBlock }
  | { type: 'tool'; block: ToolBlock }
  | null;

/** What the lane is doing at `t`: a model call first (that is where heat is), then a step, then a tool call. */
export function activeAt(lane: Lane, t: number): ActiveWork {
  if (t >= lane.end) return null;
  const model = lane.models.find((block) => block.start <= t && t < block.end);
  if (model) return { type: 'model', block: model };
  const step = lane.steps.find((block) => block.start <= t && t < block.end);
  if (step) return { type: 'step', block: step };
  const tool = lane.tools.find((block) => block.start <= t && t < block.end);
  return tool ? { type: 'tool', block: tool } : null;
}

/**
 * The instants worth stopping at when stepping through playback: where something starts, plus the end of
 * each lane. Instants closer together than `minGapRatio` of the duration are merged, so a 0.3 ms tool call
 * does not become its own keyboard stop.
 */
export function eventTimes(playback: Playback, minGapRatio = 0.004): number[] {
  const raw = new Set<number>([0]);
  for (const lane of playback.lanes) {
    raw.add(lane.end);
    for (const block of lane.models) raw.add(block.start);
    for (const block of lane.steps) raw.add(block.start);
    for (const block of lane.tools) raw.add(block.start);
    for (const mark of lane.marks) if (mark.type !== 'decision') raw.add(mark.at);
  }
  const sorted = [...raw].filter((value) => value <= playback.duration).sort((a, b) => a - b);
  const gap = playback.duration * minGapRatio;
  const out: number[] = [];
  for (const value of sorted) {
    const last = out[out.length - 1];
    if (last === undefined || value - last >= gap) out.push(value);
  }
  // The end of the longest lane is always the last stop.
  const lastTime = out[out.length - 1] ?? 0;
  if (lastTime < playback.duration) {
    if (out.length > 1 && playback.duration - lastTime < gap)
      out[out.length - 1] = playback.duration;
    else out.push(playback.duration);
  }
  return out;
}

/** The next stop strictly after `t`, or the last stop. */
export function nextEventTime(times: readonly number[], t: number): number {
  const epsilon = 1e-6;
  return times.find((value) => value > t + epsilon) ?? times[times.length - 1] ?? t;
}

/** The previous stop strictly before `t`, or the first stop. */
export function previousEventTime(times: readonly number[], t: number): number {
  const epsilon = 1e-6;
  for (let index = times.length - 1; index >= 0; index -= 1) {
    const value = times[index];
    if (value !== undefined && value < t - epsilon) return value;
  }
  return times[0] ?? 0;
}

/** Axis ticks at a "nice" interval so a 16.6 s axis reads 0, 2, 4 ... and a 2 s axis reads 0, 0.5, 1 ... */
export function axisTicks(durationMs: number, maxTicks = 10): number[] {
  if (!(durationMs > 0)) return [0];
  const rough = durationMs / maxTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((value) => value >= rough) ?? rough;
  const ticks: number[] = [];
  for (let value = 0; value <= durationMs + 1e-6; value += step)
    ticks.push(Math.round(value * 1000) / 1000);
  return ticks;
}

/** Linear scale shared by every model block of every lane: height is proportional to tokens. */
export function maxModelTokens(lanes: readonly Lane[]): number {
  let max = 0;
  for (const lane of lanes) for (const block of lane.models) max = Math.max(max, block.tokens);
  return max;
}
