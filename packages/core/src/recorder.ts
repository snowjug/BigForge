import { performance } from 'node:perf_hooks';
import type { Completion } from '@bigforge/providers';
import { redactDeep, redactSecrets } from '@bigforge/security';
import {
  type BoundaryTraceEvent,
  type DecisionEvent,
  type JsonValue,
  type ModelCallEvent,
  type NoteEvent,
  type Outcome,
  type PricingConfig,
  type ProviderRef,
  type RunKind,
  type SafetyEvent,
  type StepEvent,
  type ToolCallEvent,
  type Trace,
  type TraceEvent,
  type UsageSummary,
  type VerificationReport,
} from '@bigforge/schemas';
import { costOf } from '@bigforge/providers';
import type { Clock, IdGenerator } from './ids';

export interface RecorderOptions {
  ids: IdGenerator;
  clock: Clock;
  pricing: PricingConfig;
}

export interface StepToken {
  startOffset: number;
  wallStart: number;
  toolMsAtStart: number;
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Captures the observable execution trace in the vendor-neutral `bigforge.trace/v1` format.
 * Secrets are redacted at capture. The trace timeline is virtual: simulated model latency
 * plus measured local execution time (provenance is carried by each event).
 */
export class TraceRecorder {
  readonly events: TraceEvent[] = [];
  redactions = 0;
  private seq = 0;
  private virtualMs = 0;
  private measuredToolMs = 0;
  private readonly startedAt: Date;
  private readonly options: RecorderOptions;

  constructor(options: RecorderOptions) {
    this.options = options;
    this.startedAt = options.clock.now();
  }

  get offsetMs(): number {
    return this.virtualMs;
  }

  redact(text: string): string {
    const r = redactSecrets(text);
    this.redactions += r.count;
    return r.text;
  }

  private base() {
    const id = this.options.ids.next('evt');
    const seq = this.seq;
    this.seq += 1;
    return { id, seq, offsetMs: round3(this.virtualMs) };
  }

  modelCall(
    c: Completion,
    info: { purpose?: string; contextMessages: number; boundaryStepId?: string },
  ): ModelCallEvent {
    const redactedArgs = c.toolCalls.map((t) => ({
      name: t.name,
      args: this.redactArgs(t.args),
    }));
    const event: ModelCallEvent = {
      ...this.base(),
      kind: 'model_call',
      ...(info.purpose !== undefined ? { purpose: info.purpose } : {}),
      provider: { id: c.providerId, mode: c.mode, model: c.model },
      usage: c.usage,
      latency: c.latency,
      contextMessages: info.contextMessages,
      responsePreview: this.redact(c.text).slice(0, 2000),
      toolCalls: redactedArgs,
      ...(info.boundaryStepId !== undefined ? { boundaryStepId: info.boundaryStepId } : {}),
    };
    this.virtualMs += c.latency.ms;
    this.events.push(event);
    return event;
  }

  private redactArgs(args: Record<string, unknown>): Record<string, JsonValue> {
    const { value, count } = redactDeep(args as Record<string, JsonValue>);
    this.redactions += count;
    return value;
  }

  toolCall(info: {
    purpose?: string;
    tool: string;
    args: Record<string, unknown>;
    status: 'ok' | 'error' | 'blocked';
    durationMs: number;
    exitCode: number | null;
    output: string;
    blockedReason?: string;
    spawned: boolean;
  }): ToolCallEvent {
    const event: ToolCallEvent = {
      ...this.base(),
      kind: 'tool_call',
      ...(info.purpose !== undefined ? { purpose: info.purpose } : {}),
      tool: info.tool,
      args: this.redactArgs(info.args),
      status: info.status,
      durationMs: round3(info.durationMs),
      durationProvenance: 'measured',
      exitCode: info.exitCode,
      outputPreview: this.redact(info.output).slice(0, 2000),
      outputBytes: Buffer.byteLength(info.output, 'utf8'),
      ...(info.blockedReason !== undefined ? { blockedReason: info.blockedReason } : {}),
      spawned: info.spawned,
    };
    this.virtualMs += info.durationMs;
    this.measuredToolMs += info.durationMs;
    this.events.push(event);
    return event;
  }

  decision(info: {
    intent: string;
    by: 'model' | 'operator';
    operator?: string;
    confidence?: number;
    output: unknown;
  }): DecisionEvent {
    const { value, count } = redactDeep(info.output as JsonValue);
    this.redactions += count;
    const event: DecisionEvent = {
      ...this.base(),
      kind: 'decision',
      intent: info.intent,
      by: info.by,
      ...(info.operator !== undefined ? { operator: info.operator } : {}),
      ...(info.confidence !== undefined ? { confidence: info.confidence } : {}),
      output: value,
    };
    this.events.push(event);
    return event;
  }

  safety(info: { action: string; blocked: boolean; rule: string; reason: string }): SafetyEvent {
    const event: SafetyEvent = {
      ...this.base(),
      kind: 'safety',
      action: this.redact(info.action).slice(0, 300),
      blocked: info.blocked,
      rule: info.rule,
      reason: info.reason.slice(0, 300),
    };
    this.events.push(event);
    return event;
  }

  note(level: 'info' | 'warn', message: string): NoteEvent {
    const event: NoteEvent = {
      ...this.base(),
      kind: 'note',
      level,
      message: this.redact(message).slice(0, 500),
    };
    this.events.push(event);
    return event;
  }

  boundary(info: Omit<BoundaryTraceEvent, 'id' | 'seq' | 'offsetMs' | 'kind'>): BoundaryTraceEvent {
    const event: BoundaryTraceEvent = { ...this.base(), kind: 'boundary', ...info };
    this.events.push(event);
    return event;
  }

  beginStep(): StepToken {
    return {
      startOffset: round3(this.virtualMs),
      wallStart: performance.now(),
      toolMsAtStart: this.measuredToolMs,
    };
  }

  endStep(
    token: StepToken,
    info: {
      stepId: string;
      operator: string;
      status: StepEvent['status'];
      executor: StepEvent['executor'];
      confidence?: number;
      summary: string;
    },
  ): StepEvent {
    const wall = performance.now() - token.wallStart;
    const childMeasured = this.measuredToolMs - token.toolMsAtStart;
    this.virtualMs += Math.max(0, wall - childMeasured);
    const event: StepEvent = {
      id: this.options.ids.next('evt'),
      seq: this.seq,
      offsetMs: token.startOffset,
      kind: 'step',
      stepId: info.stepId,
      operator: info.operator,
      status: info.status,
      executor: info.executor,
      durationMs: round3(this.virtualMs - token.startOffset),
      ...(info.confidence !== undefined ? { confidence: info.confidence } : {}),
      summary: this.redact(info.summary).slice(0, 400),
    };
    this.seq += 1;
    this.events.push(event);
    return event;
  }

  finish(meta: {
    taskId: string;
    runKind: RunKind;
    agent: Trace['agent'];
    provider: ProviderRef;
    environment: Trace['environment'];
    task: Trace['task'];
    outcome: Outcome;
    verification: VerificationReport;
  }): Trace {
    const usage = summarizeUsage(this.events, this.options.pricing);
    return {
      schema: 'bigforge.trace/v1',
      id: this.options.ids.next('trc'),
      taskId: meta.taskId,
      runKind: meta.runKind,
      agent: meta.agent,
      provider: meta.provider,
      environment: meta.environment,
      task: meta.task,
      startedAt: this.startedAt.toISOString(),
      endedAt: this.options.clock.now().toISOString(),
      events: this.events,
      outcome: meta.outcome,
      verification: meta.verification,
      usage,
      redaction: { applied: true, redactions: this.redactions },
    };
  }
}

export function summarizeUsage(
  events: readonly TraceEvent[],
  pricing: PricingConfig,
): UsageSummary {
  let modelCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let costUsd = 0;
  let modelLatencyMs = 0;
  let toolCalls = 0;
  let commands = 0;
  let localSteps = 0;
  let blockedActions = 0;
  let localMs = 0;
  let anySyntheticTokens = false;
  let anySimulatedLatency = false;

  for (const e of events) {
    switch (e.kind) {
      case 'model_call':
        modelCalls += 1;
        inputTokens += e.usage.inputTokens;
        outputTokens += e.usage.outputTokens;
        cachedInputTokens += e.usage.cachedInputTokens;
        modelLatencyMs += e.latency.ms;
        costUsd += costOf(pricing, e.provider.model, e.usage);
        if (e.usage.provenance === 'synthetic') anySyntheticTokens = true;
        if (e.latency.provenance === 'simulated') anySimulatedLatency = true;
        break;
      case 'tool_call':
        toolCalls += 1;
        if (e.status === 'blocked') blockedActions += 1;
        else if (e.spawned) commands += 1;
        localMs += e.durationMs;
        break;
      case 'step':
        if (e.executor === 'local') localSteps += 1;
        break;
      case 'safety':
        break;
      default:
        break;
    }
  }
  const tokenProvenance = anySyntheticTokens ? 'synthetic' : 'measured';
  return {
    modelCalls,
    inputTokens,
    outputTokens,
    cachedInputTokens,
    totalTokens: inputTokens + outputTokens,
    tokenProvenance,
    costUsd: Math.round(costUsd * 1e6) / 1e6,
    costProvenance: tokenProvenance === 'synthetic' ? 'synthetic' : 'estimated',
    toolCalls,
    commands,
    localSteps,
    blockedActions,
    modelLatencyMs: Math.round(modelLatencyMs),
    modelLatencyProvenance: anySimulatedLatency ? 'simulated' : 'measured',
    localMs: round3(localMs),
    localMsProvenance: 'measured',
  };
}
