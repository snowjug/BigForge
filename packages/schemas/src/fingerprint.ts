import { z } from 'zod';
import { JsonValue } from './common';

export const FINGERPRINT_VERSION = 'fp/1' as const;

export const FAILURE_TYPES = ['build', 'test', 'lint', 'deploy', 'unknown'] as const;
export const FailureType = z.enum(FAILURE_TYPES);
export type FailureType = z.infer<typeof FailureType>;

/**
 * Task fingerprint: rule- and feature-based (no embeddings). Describes a task by intent,
 * toolchain, repository shape, failure type, error signatures, files and capabilities,
 * never by its exact prompt text.
 */
export const Fingerprint = z.object({
  version: z.literal(FINGERPRINT_VERSION),
  intent: z.object({
    label: z.string(),
    confidence: z.number().min(0).max(1),
    terms: z.array(z.string()),
  }),
  toolchain: z.object({ manager: z.string().nullable(), tool: z.string().nullable() }),
  repo: z.object({ workspaceCount: z.number().int().nullable(), layout: z.string().nullable() }),
  failure: z.object({
    type: FailureType,
    signatures: z.array(z.string()),
    cascading: z.boolean(),
  }),
  files: z.array(z.string()),
  capabilities: z.array(z.string()),
});
export type Fingerprint = z.infer<typeof Fingerprint>;

export const MatchFeature = z.object({
  name: z.string(),
  score: z.number().min(0).max(1),
  weight: z.number().min(0).max(1),
  detail: z.string(),
});
export type MatchFeature = z.infer<typeof MatchFeature>;

export const HardGate = z.object({
  id: z.string(),
  passed: z.boolean(),
  detail: z.string(),
});
export type HardGate = z.infer<typeof HardGate>;

export const FamilyMatch = z.object({
  decision: z.enum(['match', 'no_match', 'ambiguous']),
  familyId: z.string().nullable(),
  familyName: z.string().nullable(),
  score: z.number().min(0).max(1),
  threshold: z.number().min(0).max(1),
  hardGates: z.array(HardGate),
  features: z.array(MatchFeature),
  reasons: z.array(z.string()),
});
export type FamilyMatch = z.infer<typeof FamilyMatch>;

export const FamilyMember = z.object({
  taskId: z.string(),
  scenarioId: z.string(),
  variantKey: z.string(),
  similarityToCentroid: z.number().min(0).max(1),
});
export type FamilyMember = z.infer<typeof FamilyMember>;

export const TaskFamily = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  centroid: Fingerprint,
  memberCount: z.number().int().nonnegative(),
  members: z.array(FamilyMember),
  /** Distinct (fault, workspace) variants observed in the family. */
  variants: z.array(z.string()),
  createdAt: z.string(),
});
export type TaskFamily = z.infer<typeof TaskFamily>;

export const MatcherEvaluation = z.object({
  provenance: z.literal('measured'),
  corpus: z.literal('synthetic'),
  positives: z.number().int(),
  negatives: z.number().int(),
  truePositives: z.number().int(),
  falseMatches: z.number().int(),
  falseMatchRate: z.number().min(0).max(1),
  recall: z.number().min(0).max(1),
  threshold: z.number(),
  misses: z.array(z.object({ label: z.string(), score: z.number() })),
  falseMatchExamples: z.array(z.object({ label: z.string(), score: z.number() })),
});
export type MatcherEvaluation = z.infer<typeof MatcherEvaluation>;

export const JsonRecord = z.record(z.string(), JsonValue);
