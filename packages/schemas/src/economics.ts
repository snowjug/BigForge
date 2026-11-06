import { z } from 'zod';
import { type MetricDefinition, Provenance } from './common';

export const Interval = z.object({ low: z.number(), high: z.number() });
export type Interval = z.infer<typeof Interval>;

const Amount = z.object({
  tokens: z.number(),
  costUsd: z.number(),
  provenance: Provenance,
});

export const InvestmentLine = z.object({
  id: z.enum(['shadow', 'canary', 'compile', 'replay', 'review', 'learning']),
  label: z.string(),
  runs: z.number().int(),
  tokens: z.number(),
  costUsd: z.number(),
  provenance: Provenance,
  note: z.string(),
  /** Counts toward the ROI denominator by default. */
  counted: z.boolean(),
});
export type InvestmentLine = z.infer<typeof InvestmentLine>;

export const EconomicsReport = z.object({
  generatedAt: z.string(),
  pricing: z.object({
    id: z.string(),
    assumedAt: z.string(),
    source: z.string(),
    note: z.string(),
  }),
  baseline: z.object({
    samples: z.number().int(),
    meanTokens: z.number(),
    sdTokens: z.number(),
    meanCostUsd: z.number(),
    meanModelCalls: z.number(),
    meanUncachedTokens: z.number(),
    provenance: Provenance,
  }),
  reuse: z.object({
    liveExecutions: z.number().int(),
    shadowExecutions: z.number().int(),
    verifiedLive: z.number().int(),
    meanTokens: z.number(),
    meanModelCalls: z.number(),
    meanCostUsd: z.number(),
    verificationPassRate: z.number().nullable(),
    provenance: Provenance,
  }),
  perExecution: z.object({
    tokensAvoided: z.number(),
    costAvoidedUsd: z.number(),
    interval: Interval,
    basis: z.enum(['measured_reference', 'counterfactual_estimate', 'shadow_estimate', 'none']),
    provenance: Provenance,
  }),
  investment: z.object({
    lines: z.array(InvestmentLine),
    totalTokens: z.number(),
    totalCostUsd: z.number(),
    totalCostUsdWithReview: z.number(),
  }),
  realized: z.object({
    avoidedTokens: z.number(),
    avoidedCostUsd: z.number(),
    netTokens: z.number(),
    netCostUsd: z.number(),
    roi: z.number().nullable(),
    provenance: Provenance,
  }),
  projected: z.object({
    executions: z.number().int(),
    avoidedTokens: z.number(),
    netTokens: z.number(),
    netCostUsd: z.number(),
    roi: z.number().nullable(),
    roiInterval: Interval.nullable(),
    breakEvenExecutions: z.number().int().nullable(),
    provenance: Provenance,
    assumption: z.string(),
  }),
  crr: z.object({
    value: z.number().nullable(),
    verificationPassRate: z.number().nullable(),
    runs: z.number().int(),
    provenance: Provenance,
    note: z.string(),
  }),
  series: z.array(
    z.object({
      execution: z.number().int(),
      baselineCumulative: z.number(),
      bigforgeCumulative: z.number(),
    }),
  ),
});
export type EconomicsReport = z.infer<typeof EconomicsReport>;

export const AmountSchema = Amount;

/** Definition, source, unit and limitations for every metric BigForge shows. */
export const METRIC_DEFINITIONS: Record<string, MetricDefinition> = {
  tokens_per_task: {
    id: 'tokens_per_task',
    label: 'Tokens per task',
    unit: 'tokens',
    definition:
      'Input plus output tokens consumed by model calls during one task execution, including prompt-cache hits.',
    source: 'Trace usage summary: sum of model_call events.',
    limitations:
      'Deterministic-provider values are synthetic (chars/4 estimator). Live values are provider-reported.',
  },
  model_calls: {
    id: 'model_calls',
    label: 'Model calls',
    unit: 'count',
    definition: 'Number of model invocations during a task execution.',
    source: 'Trace: count of model_call events.',
  },
  cost_usd: {
    id: 'cost_usd',
    label: 'Model cost',
    unit: 'usd',
    definition:
      'Tokens multiplied by the pinned price configuration; cached input is billed at the cached rate.',
    source: 'Trace usage + PricingConfig (an assumption with a timestamp).',
    limitations: 'Prices are assumptions, not vendor list prices.',
  },
  commands: {
    id: 'commands',
    label: 'Commands run',
    unit: 'count',
    definition:
      'Sandboxed processes spawned during a task execution (allowlisted forge-ci invocations).',
    source: 'Trace: tool_call events that spawned a process.',
  },
  model_latency: {
    id: 'model_latency',
    label: 'Model latency',
    unit: 'ms',
    definition: 'Time attributed to model calls.',
    source:
      'Deterministic provider: simulated from a documented token-based model. Live provider: wall-clock.',
    limitations: 'Simulated for the deterministic provider; never present as measured.',
  },
  local_time: {
    id: 'local_time',
    label: 'Local execution time',
    unit: 'ms',
    definition: 'Wall-clock time of sandboxed commands.',
    source: 'Measured around each spawned process.',
  },
  crr: {
    id: 'crr',
    label: 'Cognitive Reuse Ratio (proposed metric)',
    unit: 'ratio',
    definition:
      'Share of a workflow completed through previously validated reusable execution rather than fresh model reasoning, weighted by what the baseline agent spent on each step.',
    source:
      'Reflex step rationale (baseline tokens per replaced step) and which steps ran without a model.',
    formula:
      'CRR = sum(w_s for steps run locally without a model) / sum(w_s for all steps); w_s = mean baseline tokens spent on the behaviour step s replaces (minimum 1).',
    limitations:
      'A proposed project metric, not an industry standard. Meaningful only beside the verification pass rate: reusing the wrong thing confidently yields a high CRR and a bad outcome.',
  },
  cognitive_roi: {
    id: 'cognitive_roi',
    label: 'Cognitive ROI',
    unit: 'x',
    definition:
      'Net model consumption avoided relative to the cost of learning and validating the Reflex.',
    source: 'Ledger of shadow, canary, compile, replay and review costs versus realised savings.',
    formula: 'ROI = (cost avoided - cost to learn) / cost to learn',
    limitations:
      'Counterfactual tokens avoided are estimates unless a measured baseline reference exists. Projected figures depend on an explicit execution-volume assumption.',
  },
  false_match_rate: {
    id: 'false_match_rate',
    label: 'False Reflex match rate',
    unit: 'ratio',
    definition: 'Share of out-of-family tasks the matcher wrongly assigned to the family.',
    source: 'Matcher evaluation on a labelled synthetic corpus.',
    limitations: 'Small synthetic corpus: a demonstration of the mechanism, not a general rate.',
  },
  shadow_agreement: {
    id: 'shadow_agreement',
    label: 'Shadow agreement',
    unit: 'ratio',
    definition:
      'Share of shadow runs where the Reflex and the baseline agree on outcome, root cause, final files and verification, with zero Reflex safety violations.',
    source: 'Comparisons recorded by Shadow Brain.',
  },
  reflex_confidence: {
    id: 'reflex_confidence',
    label: 'Reflex confidence',
    unit: 'ratio',
    definition:
      'Posterior mean agreement over the most recent 12 comparisons with a Beta(1,1) prior: (agreements + 1) / (n + 2).',
    source: 'Shadow, canary and live verification results.',
    limitations: 'Example estimator; thresholds are configurable and not validated.',
  },
  uncertainty_boundary_size: {
    id: 'uncertainty_boundary_size',
    label: 'Uncertainty boundary size',
    unit: 'tokens',
    definition: 'Tokens the Token Firewall allowed into a model call at an uncertainty boundary.',
    source: 'Firewall decision: tokens of selected evidence.',
  },
  context_reduction: {
    id: 'context_reduction',
    label: 'Context reduction',
    unit: 'percent',
    definition:
      'Tokens withheld by the Token Firewall relative to all evidence the run had observed.',
    source: 'Firewall decision: (considered - selected) / considered.',
  },
};
