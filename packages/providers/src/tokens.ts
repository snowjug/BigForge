import { type ModelPrice, type PricingConfig, type TokenUsage } from '@bigforge/schemas';

/**
 * Deterministic token estimator: ceil(utf8 length / 4). Used for the deterministic provider
 * (labelled `synthetic`) and for pre-call size estimates (labelled `estimated`).
 */
export function estimateTokens(text: string): number {
  if (text.length === 0) return 0;
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

/**
 * Synthetic demo prices. These are an ASSUMPTION used to make cost arithmetic reproducible;
 * they are not any vendor's list price. Replace via configuration for live use.
 */
export const DEFAULT_PRICING: PricingConfig = {
  id: 'forge-sim-demo-2026-11',
  currency: 'USD',
  assumedAt: '2026-11-06T00:00:00Z',
  source: 'assumption',
  note: 'Synthetic demo prices for reproducible arithmetic. Not a vendor list price.',
  models: {
    'forge-sim-large': { inputPerMTok: 3, outputPerMTok: 12, cachedInputPerMTok: 0.3 },
    'forge-sim-standard': { inputPerMTok: 0.8, outputPerMTok: 3.2, cachedInputPerMTok: 0.08 },
    'forge-sim-small': { inputPerMTok: 0.25, outputPerMTok: 1, cachedInputPerMTok: 0.025 },
  },
};

const FALLBACK_PRICE: ModelPrice = { inputPerMTok: 3, outputPerMTok: 12, cachedInputPerMTok: 0.3 };

export function priceFor(pricing: PricingConfig, model: string): ModelPrice {
  return pricing.models[model] ?? FALLBACK_PRICE;
}

/** Cost in USD for one call. Cached input tokens are billed at the cached rate. */
export function costOf(pricing: PricingConfig, model: string, usage: TokenUsage): number {
  const p = priceFor(pricing, model);
  const uncached = Math.max(0, usage.inputTokens - usage.cachedInputTokens);
  return (
    (uncached * p.inputPerMTok +
      usage.cachedInputTokens * p.cachedInputPerMTok +
      usage.outputTokens * p.outputPerMTok) /
    1_000_000
  );
}
