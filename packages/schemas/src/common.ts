import { z } from 'zod';

/**
 * Provenance labels. Every number BigForge shows carries one of these so that
 * synthetic, simulated, estimated and genuinely measured values are never blended.
 *
 * - measured:        observed from a real system (local command duration, live provider usage)
 * - synthetic:       produced by the deterministic provider (stands in for a model; offline demo)
 * - simulated:       computed from a documented deterministic model (e.g. simulated model latency)
 * - estimated:       counterfactual or projected value derived from other data
 * - replay-measured: measured by re-running a recorded task against a Reflex
 */
export const PROVENANCE = [
  'measured',
  'synthetic',
  'simulated',
  'estimated',
  'replay-measured',
] as const;
export const Provenance = z.enum(PROVENANCE);
export type Provenance = z.infer<typeof Provenance>;

export const IsoTimestamp = z.string().min(10).max(40);
export const Id = z.string().min(1).max(120);

export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export const JsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValue),
    z.record(z.string(), JsonValue),
  ]),
);

export const UNITS = ['tokens', 'ms', 'usd', 'count', 'ratio', 'percent', 'bytes', 'x'] as const;
export const Unit = z.enum(UNITS);
export type Unit = z.infer<typeof Unit>;

export const TokenUsage = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  /** Subset of inputTokens served from a prompt cache (synthetic for the deterministic provider). */
  cachedInputTokens: z.number().int().nonnegative(),
  provenance: Provenance,
});
export type TokenUsage = z.infer<typeof TokenUsage>;

export const Latency = z.object({
  ms: z.number().nonnegative(),
  provenance: Provenance,
});
export type Latency = z.infer<typeof Latency>;

export const ModelPrice = z.object({
  inputPerMTok: z.number().nonnegative(),
  outputPerMTok: z.number().nonnegative(),
  cachedInputPerMTok: z.number().nonnegative(),
});
export type ModelPrice = z.infer<typeof ModelPrice>;

/** Pricing is configuration, not fact: it is recorded with a timestamp and a source label. */
export const PricingConfig = z.object({
  id: z.string(),
  currency: z.literal('USD'),
  assumedAt: IsoTimestamp,
  source: z.enum(['assumption', 'provider-list']),
  note: z.string(),
  models: z.record(z.string(), ModelPrice),
});
export type PricingConfig = z.infer<typeof PricingConfig>;

export const MetricValue = z.object({
  id: z.string(),
  label: z.string(),
  value: z.number().nullable(),
  unit: Unit,
  /** More than one entry means a composite figure whose components differ in provenance. */
  provenance: z.array(Provenance).min(1),
  interval: z.object({ low: z.number(), high: z.number() }).optional(),
  detail: z.string().optional(),
});
export type MetricValue = z.infer<typeof MetricValue>;

export const MetricDefinition = z.object({
  id: z.string(),
  label: z.string(),
  unit: Unit,
  definition: z.string(),
  source: z.string(),
  formula: z.string().optional(),
  limitations: z.string().optional(),
});
export type MetricDefinition = z.infer<typeof MetricDefinition>;

export const Page = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    nextCursor: z.string().nullable(),
    total: z.number().int().nonnegative(),
  });

export const PAGE_LIMIT_MAX = 100;
export const PAGE_LIMIT_DEFAULT = 25;

export const PageQuery = z.object({
  limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
  cursor: z.string().max(200).optional(),
});
export type PageQuery = z.infer<typeof PageQuery>;
