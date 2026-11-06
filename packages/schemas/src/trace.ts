import { z } from 'zod';
import { Id, IsoTimestamp, JsonValue, Latency, Provenance, TokenUsage } from './common';

export const VERIFICATION_RULE_IDS = [
  'original_failure_gone',
  'relevant_tests_pass',
  'no_unrelated_changes',
  'security_policy_pass',
] as const;
export const VerificationRuleId = z.enum(VERIFICATION_RULE_IDS);
export type VerificationRuleId = z.infer<typeof VerificationRuleId>;

export const VerificationRuleResult = z.object({
  id: z.string(),
  label: z.string(),
  status: z.enum(['pass', 'fail', 'skipped']),
  evidence: z.string(),
});
export type VerificationRuleResult = z.infer<typeof VerificationRuleResult>;

/** Objective completion evidence. Produced by the verifier, never by the agent. */
export const VerificationReport = z.object({
  verifier: z.literal('bigforge.verifier/1'),
  status: z.enum(['pass', 'fail', 'incomplete']),
  rules: z.array(VerificationRuleResult),
  verifiedAt: IsoTimestamp,
});
export type VerificationReport = z.infer<typeof VerificationReport>;

const EventBase = z.object({
  id: Id,
  seq: z.number().int().nonnegative(),
  /** Offset since trace start. Model latency is simulated for the deterministic provider. */
  offsetMs: z.number().nonnegative(),
});

export const ProviderRef = z.object({
  id: z.string(),
  mode: z.enum(['deterministic', 'live']),
  model: z.string(),
});
export type ProviderRef = z.infer<typeof ProviderRef>;

export const ModelCallEvent = EventBase.extend({
  kind: z.literal('model_call'),
  /** Harness-provided semantic label, e.g. "locate_root_cause". Used by the Reflex Compiler. */
  purpose: z.string().max(80).optional(),
  provider: ProviderRef,
  usage: TokenUsage,
  latency: Latency,
  contextMessages: z.number().int().nonnegative(),
  responsePreview: z.string().max(2000),
  toolCalls: z.array(z.object({ name: z.string(), args: z.record(z.string(), JsonValue) })),
  /** Which Reflex step crossed the uncertainty boundary, if any. */
  boundaryStepId: z.string().optional(),
});
export type ModelCallEvent = z.infer<typeof ModelCallEvent>;

export const ToolCallEvent = EventBase.extend({
  kind: z.literal('tool_call'),
  purpose: z.string().max(80).optional(),
  tool: z.string(),
  args: z.record(z.string(), JsonValue),
  status: z.enum(['ok', 'error', 'blocked']),
  durationMs: z.number().nonnegative(),
  durationProvenance: Provenance,
  exitCode: z.number().int().nullable(),
  outputPreview: z.string().max(4000),
  outputBytes: z.number().int().nonnegative(),
  blockedReason: z.string().optional(),
  /** True when the call spawned a sandboxed process (as opposed to an in-process file operation). */
  spawned: z.boolean(),
});
export type ToolCallEvent = z.infer<typeof ToolCallEvent>;

export const DecisionEvent = EventBase.extend({
  kind: z.literal('decision'),
  intent: z.string().max(80),
  by: z.enum(['model', 'operator']),
  operator: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  output: JsonValue,
});
export type DecisionEvent = z.infer<typeof DecisionEvent>;

export const StepEvent = EventBase.extend({
  kind: z.literal('step'),
  stepId: z.string(),
  operator: z.string(),
  status: z.enum(['ok', 'escalated', 'stopped', 'skipped']),
  executor: z.enum(['local', 'model']),
  durationMs: z.number().nonnegative(),
  confidence: z.number().min(0).max(1).optional(),
  summary: z.string().max(400),
});
export type StepEvent = z.infer<typeof StepEvent>;

export const SafetyEvent = EventBase.extend({
  kind: z.literal('safety'),
  action: z.string(),
  blocked: z.boolean(),
  rule: z.string(),
  reason: z.string(),
});
export type SafetyEvent = z.infer<typeof SafetyEvent>;

export const NoteEvent = EventBase.extend({
  kind: z.literal('note'),
  level: z.enum(['info', 'warn']),
  message: z.string().max(500),
});
export type NoteEvent = z.infer<typeof NoteEvent>;

export const BoundaryTraceEvent = EventBase.extend({
  kind: z.literal('boundary'),
  stepId: z.string(),
  question: z.string(),
  reason: z.string(),
  verdict: z.string(),
  contextTokensBefore: z.number().int().nonnegative(),
  contextTokensAfter: z.number().int().nonnegative(),
});
export type BoundaryTraceEvent = z.infer<typeof BoundaryTraceEvent>;

export const TraceEvent = z.discriminatedUnion('kind', [
  ModelCallEvent,
  ToolCallEvent,
  DecisionEvent,
  StepEvent,
  SafetyEvent,
  NoteEvent,
  BoundaryTraceEvent,
]);
export type TraceEvent = z.infer<typeof TraceEvent>;

export const RootFailure = z.object({
  workspace: z.string(),
  code: z.string(),
  message: z.string(),
  file: z.string().nullable(),
  line: z.number().int().nullable(),
});
export type RootFailure = z.infer<typeof RootFailure>;

export const Outcome = z.object({
  status: z.enum(['success', 'failed', 'stopped', 'fallback']),
  summary: z.string().max(600),
  rootFailure: RootFailure.nullable(),
  remedyKind: z.string().nullable(),
  remedySummary: z.string().nullable(),
  changedFiles: z.array(z.string()),
});
export type Outcome = z.infer<typeof Outcome>;

export const UsageSummary = z.object({
  modelCalls: z.number().int().nonnegative(),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cachedInputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  tokenProvenance: Provenance,
  costUsd: z.number().nonnegative(),
  costProvenance: Provenance,
  toolCalls: z.number().int().nonnegative(),
  commands: z.number().int().nonnegative(),
  localSteps: z.number().int().nonnegative(),
  blockedActions: z.number().int().nonnegative(),
  modelLatencyMs: z.number().nonnegative(),
  modelLatencyProvenance: Provenance,
  localMs: z.number().nonnegative(),
  localMsProvenance: Provenance,
});
export type UsageSummary = z.infer<typeof UsageSummary>;

export const RUN_KINDS = [
  'baseline',
  'reflex',
  'shadow_baseline',
  'shadow_reflex',
  'replay_reflex',
  'canary_baseline',
  'canary_reflex',
] as const;
export const RunKind = z.enum(RUN_KINDS);
export type RunKind = z.infer<typeof RunKind>;

/** `bigforge.trace/v1`: vendor-neutral execution trace. */
export const Trace = z.object({
  schema: z.literal('bigforge.trace/v1'),
  id: Id,
  taskId: Id,
  runKind: RunKind,
  agent: z.object({
    name: z.string(),
    kind: z.enum(['baseline', 'reflex']),
    reflexId: z.string().nullable(),
    reflexVersion: z.string().nullable(),
  }),
  provider: ProviderRef,
  environment: z.object({
    toolchain: z.object({ name: z.string(), version: z.string() }),
    platform: z.string(),
  }),
  task: z.object({
    prompt: z.string(),
    scenarioId: z.string(),
    variantKey: z.string(),
  }),
  startedAt: IsoTimestamp,
  endedAt: IsoTimestamp,
  events: z.array(TraceEvent),
  outcome: Outcome,
  verification: VerificationReport,
  usage: UsageSummary,
  redaction: z.object({ applied: z.boolean(), redactions: z.number().int().nonnegative() }),
});
export type Trace = z.infer<typeof Trace>;
