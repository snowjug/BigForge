import { z } from 'zod';
import { JsonValue } from './common';

/**
 * Safe, declarative expressions. Reflexes never contain executable code or eval-able strings:
 * conditions and bindings are data interpreted by a small, closed evaluator.
 */
export const Operand = z.union([
  z.object({ ref: z.string().max(200) }),
  z.object({ const: JsonValue }),
]);
export type Operand = z.infer<typeof Operand>;

export type Condition =
  | {
      op: 'eq' | 'neq' | 'lt' | 'lte' | 'gt' | 'gte' | 'contains' | 'in';
      left: Operand;
      right: Operand;
    }
  | { op: 'exists' | 'not_exists'; left: Operand }
  | { op: 'all' | 'any'; conditions: Condition[] }
  | { op: 'not'; condition: Condition };

export const Condition: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(['eq', 'neq', 'lt', 'lte', 'gt', 'gte', 'contains', 'in']),
      left: Operand,
      right: Operand,
    }),
    z.object({ op: z.enum(['exists', 'not_exists']), left: Operand }),
    z.object({ op: z.enum(['all', 'any']), conditions: z.array(Condition).max(16) }),
    z.object({ op: z.literal('not'), condition: Condition }),
  ]),
);

export const Binding = Operand;
export type Binding = z.infer<typeof Binding>;

export const OperatorRef = z.object({
  id: z.string().regex(/^local\.[a-z0-9_]+$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
});
export type OperatorRef = z.infer<typeof OperatorRef>;

export const STEP_KINDS = ['known', 'validation', 'hybrid', 'boundary', 'verification'] as const;
export const StepKind = z.enum(STEP_KINDS);
export type StepKind = z.infer<typeof StepKind>;

export const MODEL_TIERS = ['small', 'standard', 'large'] as const;
export const ModelTier = z.enum(MODEL_TIERS);
export type ModelTier = z.infer<typeof ModelTier>;

export const EvidenceSelector = z.object({
  id: z.string(),
  /** Which evidence chunk tags this selector accepts (matched against operator-produced chunks). */
  tags: z.array(z.string()).min(1),
  required: z.boolean(),
});
export type EvidenceSelector = z.infer<typeof EvidenceSelector>;

/** The uncertainty boundary: the smallest unresolved decision and the evidence it may carry. */
export const BoundarySpec = z.object({
  question: z.string().max(400),
  kind: z.literal('choose_option'),
  /** Reference to the list of options (each {id,label,detail,payload}) in the step output. */
  optionsFrom: z.string().max(120),
  /** Key in the step output that receives the chosen option's payload. */
  resolveInto: z.string().max(60),
  evidenceSelectors: z.array(EvidenceSelector).min(1),
  budgetTokens: z.number().int().positive().max(20000),
  minCapability: ModelTier,
  evidenceRequired: z.string().max(300),
  verifyBy: z.string().max(300),
});
export type BoundarySpec = z.infer<typeof BoundarySpec>;

export const PermissionRequirement = z.object({
  read: z.array(z.string()),
  write: z.array(z.string()),
  commands: z.array(z.string()),
});
export type PermissionRequirement = z.infer<typeof PermissionRequirement>;

export const StepRationale = z.object({
  /** Baseline trace purposes this step replaces. */
  replaces: z.array(z.string()),
  /** Fraction of aligned traces in which the replaced behaviour appeared (1 = invariant). */
  conservation: z.number().min(0).max(1),
  /** Mean baseline tokens spent on the replaced model call(s), across source traces (synthetic). */
  baselineTokens: z.number().nonnegative(),
  selectedBecause: z.string().max(400),
  alternatives: z.array(
    z.object({
      operator: z.string(),
      consistent: z.boolean(),
      matched: z.number().int(),
      of: z.number().int(),
    }),
  ),
});
export type StepRationale = z.infer<typeof StepRationale>;

export const ReflexStep = z.object({
  id: z.string().regex(/^[a-z][a-z0-9_]*$/),
  title: z.string().max(80),
  kind: StepKind,
  operator: OperatorRef,
  args: z.record(z.string(), Binding),
  dependsOn: z.array(z.string()),
  /** If any condition holds after the operator ran, the step crosses its uncertainty boundary. */
  escalateWhen: z.array(Condition).max(8),
  /** If any condition holds the Reflex stops and hands control back. Never improvise. */
  stopWhen: z.array(Condition).max(8),
  boundary: BoundarySpec.optional(),
  rationale: StepRationale,
});
export type ReflexStep = z.infer<typeof ReflexStep>;

export const CommandPattern = z.object({
  program: z.string(),
  subcommands: z.array(z.string()),
});
export type CommandPattern = z.infer<typeof CommandPattern>;

export const ReflexPermissions = z.object({
  read: z.array(z.string()),
  write: z.array(z.string()),
  commands: z.array(CommandPattern),
  limits: z.object({
    network: z.literal(false),
    secrets: z.literal('none'),
    timeoutS: z.number().int().positive().max(600),
    maxOutputBytes: z.number().int().positive().max(5_000_000),
    maxSteps: z.number().int().positive().max(64),
  }),
});
export type ReflexPermissions = z.infer<typeof ReflexPermissions>;

export const InputSpec = z.object({
  type: z.enum(['path', 'string']),
  description: z.string(),
  required: z.boolean(),
});
export type InputSpec = z.infer<typeof InputSpec>;

export const VerifyRuleRef = z.object({
  id: z.string(),
  description: z.string(),
});
export type VerifyRuleRef = z.infer<typeof VerifyRuleRef>;

export const ReflexProvenance = z.object({
  compilerVersion: z.string(),
  sourceTraceIds: z.array(z.string()),
  sourceVariants: z.array(z.string()),
  excludedTraceIds: z.array(z.object({ traceId: z.string(), reason: z.string() })),
  /** Assumptions the compiler had to make; a human reviewer should read these. */
  assumptions: z.array(z.string()),
  mutationOf: z.object({ reflexVersion: z.string(), reason: z.string() }).nullable(),
});
export type ReflexProvenance = z.infer<typeof ReflexProvenance>;

/**
 * `bigforge.reflex/v1` content. Immutable once compiled: lifecycle status, trust and
 * validation evidence live beside it (see ReflexVersionRecord) and the spec is content-hashed.
 */
export const ReflexSpec = z.object({
  schema: z.literal('bigforge.reflex/v1'),
  name: z.string().regex(/^[a-z][a-z0-9-]*$/),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  familyId: z.string(),
  description: z.string().max(400),
  inputs: z.record(z.string(), InputSpec),
  preconditions: z.array(Condition),
  steps: z.array(ReflexStep).min(1).max(64),
  outputs: z.record(z.string(), Binding),
  permissions: ReflexPermissions,
  verify: z.array(VerifyRuleRef),
  compatibility: z.object({
    toolchain: z.object({ name: z.string(), observed: z.array(z.string()), range: z.string() }),
  }),
  rollbackTo: z.string().nullable(),
  provenance: ReflexProvenance,
});
export type ReflexSpec = z.infer<typeof ReflexSpec>;

export const REFLEX_STATUSES = [
  'candidate',
  'replay',
  'shadow',
  'approval',
  'active',
  'watch',
  'recompile',
  'deprecated',
  'retired',
] as const;
export const ReflexStatus = z.enum(REFLEX_STATUSES);
export type ReflexStatus = z.infer<typeof ReflexStatus>;

/** Evidence gate for promotion. Configurable; example defaults, not validated recommendations. */
export const PromotionGate = z.object({
  minShadowRuns: z.number().int().positive(),
  minDistinctVariants: z.number().int().positive(),
  maxSafetyViolations: z.number().int().nonnegative(),
  minAgreement: z.number().min(0).max(1),
  minReplayAgreement: z.number().min(0).max(1),
});
export type PromotionGate = z.infer<typeof PromotionGate>;

export const DEFAULT_PROMOTION_GATE: PromotionGate = {
  minShadowRuns: 10,
  minDistinctVariants: 3,
  maxSafetyViolations: 0,
  minAgreement: 0.95,
  minReplayAgreement: 1,
};
