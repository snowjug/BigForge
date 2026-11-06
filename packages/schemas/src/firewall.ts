import { z } from 'zod';
import { ModelTier } from './reflex';

export const FIREWALL_VERDICTS = [
  'ALLOW',
  'REDUCE_CONTEXT',
  'USE_SMALLER_MODEL',
  'USE_EXISTING_REFLEX',
  'REQUEST_HUMAN_APPROVAL',
  'DENY',
  'ESCALATE',
] as const;
export const FirewallVerdict = z.enum(FIREWALL_VERDICTS);
export type FirewallVerdict = z.infer<typeof FirewallVerdict>;

export const EvidenceChunk = z.object({
  id: z.string(),
  /** Where it came from, e.g. "log", "file:packages/security/src/token.ts", "operator:select_remedy". */
  source: z.string(),
  text: z.string(),
  tokens: z.number().int().nonnegative(),
  tags: z.array(z.string()),
});
export type EvidenceChunk = z.infer<typeof EvidenceChunk>;

export const RejectedEvidence = z.object({
  chunkId: z.string(),
  source: z.string(),
  tokens: z.number().int().nonnegative(),
  reason: z.string(),
});
export type RejectedEvidence = z.infer<typeof RejectedEvidence>;

export const EvidenceScreening = z.object({
  chunkId: z.string(),
  finding: z.enum(['clean', 'redacted', 'instruction_like']),
  detail: z.string(),
});
export type EvidenceScreening = z.infer<typeof EvidenceScreening>;

/** The seven Token Firewall questions, answered before any model call may exist. */
export const CallRecord = z.object({
  id: z.string(),
  stepId: z.string(),
  unknown: z.string(),
  whyNotReflex: z.string(),
  minimumContext: z.array(z.object({ chunkId: z.string(), reason: z.string() })),
  capability: ModelTier,
  maxBudgetTokens: z.number().int().positive(),
  evidenceRequired: z.string(),
  verifyBy: z.string(),
  options: z.array(z.object({ id: z.string(), label: z.string(), detail: z.string() })),
});
export type CallRecord = z.infer<typeof CallRecord>;

export const FirewallCheck = z.object({
  id: z.string(),
  question: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type FirewallCheck = z.infer<typeof FirewallCheck>;

export const FirewallDecision = z.object({
  verdict: FirewallVerdict,
  /** Verdicts reached before the final one, e.g. REDUCE_CONTEXT then ALLOW. */
  path: z.array(FirewallVerdict),
  reasons: z.array(z.string()),
  checks: z.array(FirewallCheck),
  tier: ModelTier,
  budgetTokens: z.number().int().nonnegative(),
  considered: z.array(EvidenceChunk),
  selected: z.array(EvidenceChunk),
  rejected: z.array(RejectedEvidence),
  screening: z.array(EvidenceScreening),
  tokensConsidered: z.number().int().nonnegative(),
  tokensSelected: z.number().int().nonnegative(),
});
export type FirewallDecision = z.infer<typeof FirewallDecision>;

export const BoundaryResolution = z.object({
  stepId: z.string(),
  question: z.string(),
  reason: z.string(),
  record: CallRecord,
  decision: FirewallDecision,
  /** Present when a model call was authorised and made. */
  call: z
    .object({
      provider: z.string(),
      mode: z.enum(['deterministic', 'live']),
      model: z.string(),
      inputTokens: z.number().int(),
      outputTokens: z.number().int(),
      cachedInputTokens: z.number().int(),
      tokenProvenance: z.enum(['synthetic', 'measured']),
      latencyMs: z.number(),
      latencyProvenance: z.enum(['simulated', 'measured']),
      requestPreview: z.string(),
      responsePreview: z.string(),
    })
    .nullable(),
  answer: z
    .object({
      choiceId: z.string(),
      rationale: z.string(),
      confidence: z.number().min(0).max(1),
      validated: z.boolean(),
    })
    .nullable(),
  outcome: z.enum(['resolved', 'denied', 'invalid_output', 'provider_error', 'needs_human']),
});
export type BoundaryResolution = z.infer<typeof BoundaryResolution>;
