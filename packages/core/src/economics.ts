import type { EconomicsReport, InvestmentLine, Provenance } from '@bigforge/schemas';

export interface UsagePoint {
  tokens: number;
  uncachedTokens: number;
  costUsd: number;
  modelCalls: number;
  provenance: Provenance;
}

export interface ReflexRunPoint {
  usage: UsagePoint;
  verified: boolean;
  purpose: 'shadow' | 'live' | 'replay' | 'canary';
  /** Measured baseline reference for the same task, when one was actually run. */
  reference: UsagePoint | null;
  crr: number | null;
}

export interface EconomicsInput {
  pricing: { id: string; assumedAt: string; source: string; note: string };
  now: string;
  /** Every baseline agent run on family tasks (learning and shadow reference runs). */
  baselineSamples: UsagePoint[];
  /** Baseline runs executed ONLY to compare (shadow). */
  shadowReference: UsagePoint[];
  /** Baseline runs executed ONLY as drift-canary references. */
  canaryReference: UsagePoint[];
  /** Baseline runs that were needed to solve the learning tasks anyway. */
  learningBaseline: UsagePoint[];
  reflexRuns: ReflexRunPoint[];
  compileMs: number;
  replayRuns: number;
  review: { minutes: number; usdPerHour: number };
  projectedExecutions: number;
  /** Conservative view: count learning-task spend as investment even though it would have been spent anyway. */
  includeLearningInInvestment: boolean;
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : 0);
const sd = (xs: number[]) => {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
};
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

const tokenProvenance = (points: UsagePoint[]): Provenance =>
  points.some((p) => p.provenance === 'synthetic') ? 'synthetic' : 'measured';

/**
 * Cognitive economics: what learning cost, what reuse saved, and when it breaks even.
 *
 * Honesty rules: investment includes shadow and canary reference runs and review time;
 * counterfactual savings are labelled `estimated` unless a measured baseline reference
 * exists for that very task; projections state their volume assumption and carry an interval.
 */
export function computeEconomics(input: EconomicsInput): EconomicsReport {
  const base = input.baselineSamples;
  const baseTokens = base.map((b) => b.tokens);
  const baselineMean = mean(baseTokens);
  const baselineSd = sd(baseTokens);
  const baselineCost = mean(base.map((b) => b.costUsd));

  const live = input.reflexRuns.filter((r) => r.purpose === 'live');
  const shadow = input.reflexRuns.filter((r) => r.purpose === 'shadow');
  const verifiedLive = live.filter((r) => r.verified);

  // Savings per live execution: measured reference when available, otherwise the counterfactual mean.
  const savings = verifiedLive.map((r) => {
    const refTokens = r.reference ? r.reference.tokens : baselineMean;
    const refCost = r.reference ? r.reference.costUsd : baselineCost;
    return {
      tokens: refTokens - r.usage.tokens,
      cost: refCost - r.usage.costUsd,
      measured: r.reference !== null,
      baselineTokens: refTokens,
      reflexTokens: r.usage.tokens,
    };
  });
  const realizedTokens = sum(savings.map((s) => s.tokens));
  const realizedCost = sum(savings.map((s) => s.cost));
  const allMeasured = savings.length > 0 && savings.every((s) => s.measured);

  const reflexMeanTokens = mean([...live, ...shadow].map((r) => r.usage.tokens));
  const reflexMeanCost = mean([...live, ...shadow].map((r) => r.usage.costUsd));
  let perTokens: number;
  let perCost: number;
  let basis: EconomicsReport['perExecution']['basis'];
  if (savings.length > 0) {
    perTokens = mean(savings.map((s) => s.tokens));
    perCost = mean(savings.map((s) => s.cost));
    basis = allMeasured ? 'measured_reference' : 'counterfactual_estimate';
  } else if (shadow.length > 0 && base.length > 0) {
    perTokens = baselineMean - reflexMeanTokens;
    perCost = baselineCost - reflexMeanCost;
    basis = 'shadow_estimate';
  } else {
    perTokens = 0;
    perCost = 0;
    basis = 'none';
  }
  const se = base.length > 1 ? baselineSd / Math.sqrt(base.length) : 0;
  const interval = { low: round(perTokens - 1.96 * se, 0), high: round(perTokens + 1.96 * se, 0) };

  const reviewCost = (input.review.minutes / 60) * input.review.usdPerHour;
  const lines: InvestmentLine[] = [
    {
      id: 'shadow',
      label: 'Shadow reference runs',
      runs: input.shadowReference.length,
      tokens: sum(input.shadowReference.map((p) => p.tokens)),
      costUsd: sum(input.shadowReference.map((p) => p.costUsd)),
      provenance: tokenProvenance(input.shadowReference),
      note: 'Baseline agent runs executed only to compare against the candidate Reflex.',
      counted: true,
    },
    {
      id: 'canary',
      label: 'Drift canary reference runs',
      runs: input.canaryReference.length,
      tokens: sum(input.canaryReference.map((p) => p.tokens)),
      costUsd: sum(input.canaryReference.map((p) => p.costUsd)),
      provenance: tokenProvenance(input.canaryReference),
      note: 'The price of vigilance: familiar tasks sent through the baseline to check for drift.',
      counted: true,
    },
    {
      id: 'compile',
      label: 'Compilation',
      runs: 1,
      tokens: 0,
      costUsd: 0,
      provenance: 'measured',
      note: `Deterministic compiler: no model tokens. ${Math.round(input.compileMs)} ms of local compute.`,
      counted: true,
    },
    {
      id: 'replay',
      label: 'Historical replay',
      runs: input.replayRuns,
      tokens: sum(
        input.reflexRuns.filter((r) => r.purpose === 'replay').map((r) => r.usage.tokens),
      ),
      costUsd: 0,
      provenance: 'replay-measured',
      note: 'Replaying recorded tasks against the candidate; local commands only.',
      counted: true,
    },
    {
      id: 'review',
      label: 'Human review',
      runs: 1,
      tokens: 0,
      costUsd: round(reviewCost, 4),
      provenance: 'estimated',
      note: `Assumption: ${input.review.minutes} minutes at $${input.review.usdPerHour}/hour. Humans spend time, not tokens.`,
      counted: true,
    },
    {
      id: 'learning',
      label: 'Learning-task baseline runs',
      runs: input.learningBaseline.length,
      tokens: sum(input.learningBaseline.map((p) => p.tokens)),
      costUsd: sum(input.learningBaseline.map((p) => p.costUsd)),
      provenance: tokenProvenance(input.learningBaseline),
      note: 'These tasks had to be solved anyway, so they are excluded from investment by default. Enable the conservative view to include them.',
      counted: input.includeLearningInInvestment,
    },
  ];
  const counted = lines.filter((l) => l.counted);
  const investTokens = sum(counted.map((l) => l.tokens));
  const investCost = sum(counted.filter((l) => l.id !== 'review').map((l) => l.costUsd));
  const investCostWithReview =
    investCost + (counted.some((l) => l.id === 'review') ? reviewCost : 0);

  const roi = (avoided: number, invested: number) =>
    invested > 0 ? round((avoided - invested) / invested, 3) : null;
  const N = input.projectedExecutions;
  const projectedAvoided = perTokens * N;
  const roiLow =
    investTokens > 0 ? round((interval.low * N - investTokens) / investTokens, 2) : null;
  const roiHigh =
    investTokens > 0 ? round((interval.high * N - investTokens) / investTokens, 2) : null;
  const breakEven =
    perTokens > 0 && investTokens > 0
      ? Math.ceil(investTokens / perTokens)
      : perTokens > 0
        ? 0
        : null;

  const crrRuns = input.reflexRuns.filter(
    (r) => r.crr !== null && (r.purpose === 'live' || r.purpose === 'shadow'),
  );
  const verifiedAll = [...live, ...shadow];

  // Cumulative token series. Both lines are drawn on the same basis as the headline per-execution saving
  // (mean baseline and Reflex tokens of the executions that produced it), so they cross exactly where the
  // break-even says they do. Before any live execution the means of all samples are used.
  const baselinePerExecution =
    savings.length > 0 ? mean(savings.map((s) => s.baselineTokens)) : baselineMean;
  const reflexPerExecution =
    savings.length > 0 ? mean(savings.map((s) => s.reflexTokens)) : reflexMeanTokens;
  const series: EconomicsReport['series'] = [];
  const steps = Math.max(12, Math.min(N, 40));
  for (let i = 0; i <= steps; i += 1) {
    const k = Math.round((i / steps) * N);
    series.push({
      execution: k,
      baselineCumulative: Math.round(k * baselinePerExecution),
      bigforgeCumulative: Math.round(investTokens + k * reflexPerExecution),
    });
  }

  return {
    generatedAt: input.now,
    pricing: input.pricing,
    baseline: {
      samples: base.length,
      meanTokens: round(baselineMean, 0),
      sdTokens: round(baselineSd, 0),
      meanCostUsd: round(baselineCost, 5),
      meanModelCalls: round(mean(base.map((b) => b.modelCalls)), 1),
      meanUncachedTokens: round(mean(base.map((b) => b.uncachedTokens)), 0),
      provenance: tokenProvenance(base),
    },
    reuse: {
      liveExecutions: live.length,
      shadowExecutions: shadow.length,
      verifiedLive: verifiedLive.length,
      meanTokens: round(reflexMeanTokens, 0),
      meanModelCalls: round(mean([...live, ...shadow].map((r) => r.usage.modelCalls)), 2),
      meanCostUsd: round(reflexMeanCost, 5),
      verificationPassRate: verifiedAll.length
        ? round(verifiedAll.filter((r) => r.verified).length / verifiedAll.length, 3)
        : null,
      provenance: tokenProvenance([...live, ...shadow].map((r) => r.usage)),
    },
    perExecution: {
      tokensAvoided: round(perTokens, 0),
      costAvoidedUsd: round(perCost, 5),
      interval,
      basis,
      provenance: basis === 'measured_reference' ? 'synthetic' : 'estimated',
    },
    investment: {
      lines,
      totalTokens: investTokens,
      totalCostUsd: round(investCost, 5),
      totalCostUsdWithReview: round(investCostWithReview, 5),
    },
    realized: {
      avoidedTokens: round(realizedTokens, 0),
      avoidedCostUsd: round(realizedCost, 5),
      netTokens: round(realizedTokens - investTokens, 0),
      netCostUsd: round(realizedCost - investCostWithReview, 5),
      roi: roi(realizedTokens, investTokens),
      provenance: allMeasured ? 'synthetic' : 'estimated',
    },
    projected: {
      executions: N,
      avoidedTokens: round(projectedAvoided, 0),
      netTokens: round(projectedAvoided - investTokens, 0),
      netCostUsd: round(perCost * N - investCostWithReview, 4),
      roi: roi(projectedAvoided, investTokens),
      roiInterval: roiLow === null || roiHigh === null ? null : { low: roiLow, high: roiHigh },
      breakEvenExecutions: breakEven,
      provenance: 'estimated',
      assumption: `Assumes ${N} future executions of this task family, each saving the per-execution estimate. Change the assumption; the result is not a forecast.`,
    },
    crr: {
      value: crrRuns.length ? round(mean(crrRuns.map((r) => r.crr as number)), 3) : null,
      verificationPassRate: verifiedAll.length
        ? round(verifiedAll.filter((r) => r.verified).length / verifiedAll.length, 3)
        : null,
      runs: crrRuns.length,
      provenance: 'replay-measured',
      note: 'Proposed metric. Read it beside the verification pass rate.',
    },
    series,
  };
}

/** Cognitive Reuse Ratio of one run: weight of steps that ran without a model over the weight of all steps. */
export function runCrr(
  steps: {
    weight: number;
    executor: 'local' | 'model';
    status: 'ok' | 'escalated' | 'stopped' | 'skipped';
  }[],
): number | null {
  if (steps.length === 0) return null;
  const w = (s: { weight: number }) => Math.max(1, s.weight);
  const total = sum(steps.map(w));
  const reused = sum(steps.filter((s) => s.executor === 'local' && s.status === 'ok').map(w));
  return round(reused / total, 3);
}
