import type { ComparisonDto } from '@bigforge/schemas';

/** Aggregation and wording for the shadow/replay comparison table. Pure. */

export interface SideMeans {
  tokens: number;
  calls: number;
  costUsd: number;
  commands: number;
  modelLatencyMs: number;
  localMs: number;
}

export interface ComparisonTotals {
  runs: number;
  agreements: number;
  disagreements: number;
  /** Null when there are no runs: an empty set has no agreement rate. */
  agreement: number | null;
  distinctVariants: number;
  safetyViolations: number;
  baseline: SideMeans;
  reflex: SideMeans;
}

const ZERO: SideMeans = {
  tokens: 0,
  calls: 0,
  costUsd: 0,
  commands: 0,
  modelLatencyMs: 0,
  localMs: 0,
};

/** Reflex safety violations recorded in the comparison's `safety` check (the reflex column is a count). */
export function safetyViolationsOf(item: Pick<ComparisonDto, 'comparison'>): number {
  const check = item.comparison.checks.find((c) => c.id === 'safety');
  const value = Number.parseInt(check?.reflex ?? '0', 10);
  return Number.isFinite(value) ? value : 0;
}

function means(sides: readonly SideMeans[]): SideMeans {
  if (sides.length === 0) return { ...ZERO };
  const total = sides.reduce<SideMeans>(
    (sum, s) => ({
      tokens: sum.tokens + s.tokens,
      calls: sum.calls + s.calls,
      costUsd: sum.costUsd + s.costUsd,
      commands: sum.commands + s.commands,
      modelLatencyMs: sum.modelLatencyMs + s.modelLatencyMs,
      localMs: sum.localMs + s.localMs,
    }),
    { ...ZERO },
  );
  const n = sides.length;
  return {
    tokens: total.tokens / n,
    calls: total.calls / n,
    costUsd: total.costUsd / n,
    commands: total.commands / n,
    modelLatencyMs: total.modelLatencyMs / n,
    localMs: total.localMs / n,
  };
}

export function aggregateComparisons(items: readonly ComparisonDto[]): ComparisonTotals {
  const agreements = items.filter((i) => i.agree).length;
  return {
    runs: items.length,
    agreements,
    disagreements: items.length - agreements,
    agreement: items.length > 0 ? agreements / items.length : null,
    distinctVariants: new Set(items.map((i) => i.variantKey)).size,
    safetyViolations: items.reduce((n, i) => n + safetyViolationsOf(i), 0),
    baseline: means(items.map((i) => i.baseline)),
    reflex: means(items.map((i) => i.reflex)),
  };
}

/** Reduction of the Reflex against the baseline, as a ratio 0..1 (null when the baseline spent nothing). */
export function reduction(baseline: number, reflex: number): number | null {
  return baseline > 0 ? Math.max(0, (baseline - reflex) / baseline) : null;
}

const collator = new Intl.Collator('en', { numeric: true });

/** Stable order for display: by scenario id (S1, S2, S10) so a run is easy to find. */
export function byScenario(items: readonly ComparisonDto[]): ComparisonDto[] {
  return [...items].sort(
    (a, b) => collator.compare(a.scenarioId, b.scenarioId) || a.id.localeCompare(b.id),
  );
}

/** Where the Reflex and the baseline parted ways, or a plain "no divergence". */
export function divergenceText(item: Pick<ComparisonDto, 'comparison'>): string {
  const { divergence } = item.comparison;
  if (divergence.kind === 'none') return 'No divergence';
  return divergence.stepId ? `${divergence.detail} (step ${divergence.stepId})` : divergence.detail;
}

/** The checks that did not match, for the one-line reason beside a disagreement. */
export function failedChecks(item: Pick<ComparisonDto, 'comparison'>): string[] {
  return item.comparison.checks.filter((c) => !c.match).map((c) => c.label);
}

/** Tokens the baseline reference runs spent (synthetic): the learning investment a Shadow run books. */
export function totalBaselineTokens(items: readonly Pick<ComparisonDto, 'baseline'>[]): number {
  return items.reduce((sum, i) => sum + i.baseline.tokens, 0);
}
