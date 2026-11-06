import type { EconomicsReport, Provenance } from '@bigforge/schemas';
import { type BreakEvenGap, wholeExecutions } from '../../viz/charts/breakEven';
import {
  formatCount,
  formatMultiple,
  formatPct,
  formatTokens,
  formatUsd,
  plural,
} from '../../ui/formatters';

/* -------------------------------------------------------------------------------------------------
 * Assumption inputs: the projected-executions control (1 to 100,000)
 * ----------------------------------------------------------------------------------------------- */

export const EXECUTIONS_MIN = 1;
export const EXECUTIONS_MAX = 100_000;
export const EXECUTIONS_PRESETS: readonly number[] = [10, 50, 200, 1_000, 10_000];
export const SLIDER_STEPS = 100;

export const clampExecutions = (value: number): number =>
  Math.min(EXECUTIONS_MAX, Math.max(EXECUTIONS_MIN, Math.round(value)));

/** A whole number from text typed by a person ("1,000" and "1 000" are accepted). Null when it is not one. */
export function parseExecutions(text: string): number | null {
  const cleaned = text.trim().replace(/[,_\s]/g, '');
  if (!/^\d+$/.test(cleaned)) return null;
  const value = Number(cleaned);
  return Number.isSafeInteger(value) ? value : null;
}

/** The message shown under the numeric input, or null when the text is a valid in-range count. */
export function executionsError(text: string): string | null {
  const value = parseExecutions(text);
  if (value === null || value < EXECUTIONS_MIN || value > EXECUTIONS_MAX) {
    return `Enter a whole number from ${formatCount(EXECUTIONS_MIN)} to ${formatCount(EXECUTIONS_MAX)}.`;
  }
  return null;
}

/** Keeps two significant digits above 100 so a slider moves through 220, 250, 280 rather than 224, 251. */
function roundSlider(value: number): number {
  if (value < 100) return Math.round(value);
  const magnitude = 10 ** (Math.floor(Math.log10(value)) - 1);
  return Math.round(value / magnitude) * magnitude;
}

/** Slider position (0..100) to a projected execution count, on a log scale from 1 to 100,000. */
export function sliderToExecutions(position: number): number {
  const clamped = Math.min(SLIDER_STEPS, Math.max(0, position));
  const span = Math.log10(EXECUTIONS_MAX / EXECUTIONS_MIN);
  return clampExecutions(roundSlider(EXECUTIONS_MIN * 10 ** ((clamped / SLIDER_STEPS) * span)));
}

export function executionsToSlider(executions: number): number {
  const span = Math.log10(EXECUTIONS_MAX / EXECUTIONS_MIN);
  const ratio = Math.log10(clampExecutions(executions) / EXECUTIONS_MIN) / span;
  return Math.round(ratio * SLIDER_STEPS);
}

/* -------------------------------------------------------------------------------------------------
 * ROI wording: a ratio that can be negative or missing
 * ----------------------------------------------------------------------------------------------- */

export type RoiSign = 'positive' | 'negative' | 'zero' | 'none';

export interface RoiText {
  /** "+8.8×", "\u22120.95×" or an em dash. */
  text: string;
  sign: RoiSign;
  /** "positive", "negative", "break-even" or "not available": for assistive technology and plain wording. */
  words: string;
}

const MINUS = '\u2212';

/** ROI = (avoided - invested) / invested. Positive gets an explicit plus; negative a true minus. */
export function formatRoi(roi: number | null | undefined): RoiText {
  if (roi === null || roi === undefined || !Number.isFinite(roi)) {
    return { text: '\u2014', sign: 'none', words: 'not available' };
  }
  const digits = Math.abs(roi) >= 1 ? 1 : 2;
  const magnitude = formatMultiple(Math.abs(roi), digits);
  if (magnitude === formatMultiple(0, digits)) {
    return { text: magnitude, sign: 'zero', words: 'break-even' };
  }
  return roi < 0
    ? { text: `${MINUS}${magnitude}`, sign: 'negative', words: 'negative' }
    : { text: `+${magnitude}`, sign: 'positive', words: 'positive' };
}

/** "8.1× to 9.4×" for an interval, or null when there is none. */
export function formatRoiRange(interval: { low: number; high: number } | null): string | null {
  if (!interval) return null;
  return `${formatMultiple(interval.low)} to ${formatMultiple(interval.high)}`;
}

/** Share of the investment recovered: ROI + 1 (an ROI of -0.95 has paid back 5%). */
export function paybackShare(roi: number | null): number | null {
  return roi === null ? null : Math.max(0, roi + 1);
}

/** The documented formula applied to dollars: (avoided - invested) / invested = net / invested. */
export function costRoi(netCostUsd: number, investedUsd: number): number | null {
  return investedUsd > 0 ? Math.round((netCostUsd / investedUsd) * 1000) / 1000 : null;
}

/* -------------------------------------------------------------------------------------------------
 * What the report says, and what can be derived from its own fields (never re-estimated)
 * ----------------------------------------------------------------------------------------------- */

export type SavingBasis = EconomicsReport['perExecution']['basis'];

export interface SavingBasisInfo {
  label: string;
  words: string;
  tone: 'steel' | 'amber' | 'ash';
}

export function savingBasisInfo(basis: SavingBasis): SavingBasisInfo {
  switch (basis) {
    case 'measured_reference':
      return {
        label: 'Measured reference',
        words:
          'Each live execution was compared with a baseline run on the very same task, so the saving is measured against what the baseline really spent there.',
        tone: 'steel',
      };
    case 'counterfactual_estimate':
      return {
        label: 'Counterfactual estimate',
        words:
          'No baseline reference ran for these executions, so the mean of the baseline samples stands in for what the baseline would have spent. An estimate, not an observation.',
        tone: 'amber',
      };
    case 'shadow_estimate':
      return {
        label: 'Shadow estimate',
        words:
          'No live execution yet: the saving is the baseline sample mean minus what the Reflex used in shadow runs. It becomes a measured saving after a live execution.',
        tone: 'amber',
      };
    default:
      return {
        label: 'No basis yet',
        words: 'There is nothing to compare yet, so no saving can be stated.',
        tone: 'ash',
      };
  }
}

export interface Derived {
  /** Nothing to judge: the report has no per-execution saving. */
  empty: boolean;
  basis: SavingBasis;
  tokens: {
    invested: number;
    projectedRoi: number | null;
    realizedRoi: number | null;
    interval: { low: number; high: number } | null;
    breakEven: number | null;
    realizedPayback: number | null;
  };
  dollars: {
    /** The investment including the assumed review time. */
    invested: number;
    /** Model spend only (shadow, canary and, in the conservative view, learning runs). */
    modelSpend: number;
    review: number;
    reviewShare: number | null;
    projectedAvoided: number;
    projectedNet: number;
    projectedRoi: number | null;
    realizedRoi: number | null;
    /** The same projection with the review assumption removed. */
    projectedRoiWithoutReview: number | null;
    breakEven: number | null;
  };
  caching: {
    /** Share of the baseline's tokens that are prompt-cache hits (1 - uncached / total). */
    hitShare: number | null;
    usdPerMillionTokens: number | null;
  };
  /** Saving per execution minus (baseline mean - Reflex mean): non-zero when the basis is a reference run. */
  meansGap: { differenceOfMeans: number; reported: number; differs: boolean };
}

export function deriveEconomics(report: EconomicsReport): Derived {
  const { baseline, reuse, perExecution, investment, projected, realized } = report;
  const reviewLine = investment.lines.find((line) => line.id === 'review');
  const review = reviewLine?.counted ? reviewLine.costUsd : 0;
  const invested = investment.totalCostUsdWithReview;
  const projectedAvoided = projected.netCostUsd + invested;
  const projectedRoiWithoutReview =
    investment.totalCostUsd > 0
      ? Math.round(
          ((projectedAvoided - investment.totalCostUsd) / investment.totalCostUsd) * 1000,
        ) / 1000
      : null;
  const costAvoided = perExecution.costAvoidedUsd;
  const dollarBreakEven =
    costAvoided > 0 ? (invested > 0 ? Math.ceil(invested / costAvoided) : 0) : null;
  const differenceOfMeans = baseline.meanTokens - reuse.meanTokens;
  // Without a live execution nothing has been realized: the report's -1 (nothing avoided, all invested) is not a result.
  const hasLive = reuse.liveExecutions > 0;
  const realizedRoi = hasLive ? realized.roi : null;

  return {
    empty: perExecution.basis === 'none',
    basis: perExecution.basis,
    tokens: {
      invested: investment.totalTokens,
      projectedRoi: projected.roi,
      realizedRoi,
      interval: projected.roiInterval,
      breakEven: projected.breakEvenExecutions,
      realizedPayback: paybackShare(realizedRoi),
    },
    dollars: {
      invested,
      modelSpend: investment.totalCostUsd,
      review,
      reviewShare: invested > 0 && review > 0 ? review / invested : null,
      projectedAvoided,
      projectedNet: projected.netCostUsd,
      projectedRoi: costRoi(projected.netCostUsd, invested),
      realizedRoi: hasLive ? costRoi(realized.netCostUsd, invested) : null,
      projectedRoiWithoutReview,
      breakEven: dollarBreakEven,
    },
    caching: {
      hitShare:
        baseline.meanTokens > 0
          ? Math.max(0, 1 - baseline.meanUncachedTokens / baseline.meanTokens)
          : null,
      usdPerMillionTokens:
        baseline.meanTokens > 0 ? (baseline.meanCostUsd / baseline.meanTokens) * 1_000_000 : null,
    },
    meansGap: {
      differenceOfMeans,
      reported: perExecution.tokensAvoided,
      differs:
        perExecution.basis === 'measured_reference' &&
        Math.abs(perExecution.tokensAvoided - differenceOfMeans) >
          Math.max(1, 0.02 * Math.abs(differenceOfMeans)),
    },
  };
}

const unique = (kinds: readonly (Provenance | null | undefined)[]): Provenance[] => [
  ...new Set(kinds.filter((kind): kind is Provenance => Boolean(kind))),
];

/** Every component's provenance for a projected token figure (the tokens are synthetic, the projection is estimated). */
export function tokenProvenance(report: EconomicsReport): Provenance[] {
  return unique([
    report.projected.provenance,
    report.perExecution.provenance,
    report.baseline.samples > 0 ? report.baseline.provenance : null,
  ]);
}

export function realizedProvenance(report: EconomicsReport): Provenance[] {
  return unique([
    report.realized.provenance,
    report.baseline.samples > 0 ? report.baseline.provenance : null,
  ]);
}

/** Dollar figures add the review-time assumption (estimated) to prices applied to synthetic tokens. */
export function dollarProvenance(report: EconomicsReport): Provenance[] {
  const review = report.investment.lines.find((line) => line.id === 'review');
  return unique([
    report.projected.provenance,
    report.baseline.samples > 0 ? report.baseline.provenance : null,
    review?.counted ? review.provenance : null,
  ]);
}

/* -------------------------------------------------------------------------------------------------
 * The verdict in words
 * ----------------------------------------------------------------------------------------------- */

export type VerdictKind = 'empty' | 'both' | 'tokens_only' | 'dollars_only' | 'neither';

export interface VerdictFact {
  id: 'projection' | 'dollars' | 'realized';
  text: string;
}

export interface Verdict {
  kind: VerdictKind;
  headline: string;
  facts: VerdictFact[];
}

const isPositive = (value: number | null): boolean => value !== null && value > 0;

export function describeVerdict(report: EconomicsReport, derived: Derived): Verdict {
  if (derived.empty) {
    return {
      kind: 'empty',
      headline: 'Nothing to judge yet.',
      facts: [],
    };
  }
  const { tokens, dollars } = derived;
  const tokensPositive = isPositive(tokens.projectedRoi);
  const dollarsPositive = isPositive(dollars.projectedRoi);
  const kind: VerdictKind =
    tokensPositive && dollarsPositive
      ? 'both'
      : tokensPositive
        ? 'tokens_only'
        : dollarsPositive
          ? 'dollars_only'
          : 'neither';
  const headline = {
    both: 'Worth it, in tokens and in dollars.',
    tokens_only: 'Worth it in tokens. Not yet in dollars.',
    dollars_only: 'Worth it in dollars. Not in tokens.',
    neither: 'Not worth it at this volume.',
    empty: 'Nothing to judge yet.',
  }[kind];

  const n = report.projected.executions;
  const interval = formatRoiRange(tokens.interval);
  const breakEvenText =
    tokens.breakEven === null
      ? 'There is no break-even because nothing is saved per execution.'
      : tokens.breakEven > n
        ? `Break-even takes ${plural(tokens.breakEven, 'execution')}, more than the ${formatCount(n)} projected.`
        : `The investment is recovered after ${plural(tokens.breakEven, 'execution')}.`;
  const projection = `At ${formatCount(n)} projected executions the saving is ${formatTokens(report.projected.avoidedTokens)} tokens against ${formatTokens(tokens.invested)} invested: token ROI ${formatRoi(tokens.projectedRoi).text}${interval ? ` (interval ${interval})` : ''}. ${breakEvenText}`;

  const reviewPart =
    dollars.review > 0 && dollars.reviewShare !== null
      ? `, of which ${formatUsd(dollars.review)} (${formatPct(dollars.reviewShare, { digits: 0 })}) is the assumed human review`
      : '';
  const dollarBreakEven =
    dollars.breakEven === null
      ? ''
      : ` On this price sheet dollars break even after about ${formatCount(dollars.breakEven)} executions.`;
  const dollarText = `In dollars the same volume gives ${formatRoi(dollars.projectedRoi).text}: ${formatUsd(dollars.projectedAvoided)} avoided against ${formatUsd(dollars.invested)} invested${reviewPart}.${dollarBreakEven}`;

  const live = report.reuse.liveExecutions;
  const realizedText =
    live === 0
      ? 'No live execution yet: the saving is a shadow estimate and there is no realized ROI.'
      : `So far the demo ran ${plural(live, 'live execution')}: ${formatTokens(report.realized.avoidedTokens)} tokens saved, ${tokens.realizedPayback === null ? 'no payback figure' : `${formatPct(tokens.realizedPayback, { digits: tokens.realizedPayback < 0.1 ? 1 : 0 })} of the investment recovered`}, so realized token ROI is ${formatRoi(tokens.realizedRoi).text}. Projected is an extrapolation, not a forecast.`;

  return {
    kind,
    headline,
    facts: [
      { id: 'projection', text: projection },
      { id: 'dollars', text: dollarText },
      { id: 'realized', text: realizedText },
    ],
  };
}

/* -------------------------------------------------------------------------------------------------
 * Explanations that stay tied to the report's own numbers
 * ----------------------------------------------------------------------------------------------- */

/** Why dollars lag tokens, in the report's numbers. Null when there is nothing to explain. */
export function cachingSentence(report: EconomicsReport, derived: Derived): string | null {
  const { hitShare, usdPerMillionTokens } = derived.caching;
  if (hitShare === null || usdPerMillionTokens === null) return null;
  return `${formatPct(hitShare, { digits: 1 })} of the baseline's tokens are prompt-cache hits (simulated by the deterministic provider) and cached tokens are billed at a fraction of the input rate, so a token costs about ${formatUsd(usdPerMillionTokens)} per million on this price sheet. ${formatTokens(report.perExecution.tokensAvoided)} tokens avoided per execution are worth only ${formatUsd(report.perExecution.costAvoidedUsd, { digits: 4 })}.`;
}

export interface Missing {
  what: string;
  produced: string;
}

/** What the report lacks and which guided-demo step produces it. */
export function missingEvidence(report: EconomicsReport): Missing[] {
  const out: Missing[] = [];
  if (report.baseline.samples === 0) {
    out.push({
      what: 'Baseline agent runs: what solving these failures costs without a Reflex.',
      produced: 'Demo steps 2 and 4 (Run the baseline agent, Process four more failures)',
    });
  }
  if (report.reuse.shadowExecutions + report.reuse.liveExecutions === 0) {
    out.push({
      what: 'Reflex runs to compare with the baseline.',
      produced: 'Demo steps 9 and 10 (Run Shadow Brain)',
    });
  }
  if (report.reuse.liveExecutions === 0) {
    out.push({
      what: 'A live execution with a measured baseline reference. It turns the shadow estimate into a measured saving and gives a realized ROI.',
      produced: 'Demo step 14 (Execute through the Reflex)',
    });
  }
  return out;
}

/** How the BigForge line moves, in words, from its per-execution increment read off the plotted series. */
export function describeBigforgeIncrement(increment: number | null): string {
  if (increment === null) return 'and continues';
  if (increment < 0.5) return 'and then stays flat';
  const rounded = Math.round(increment);
  return `and then adds ${formatTokens(rounded)} ${rounded === 1 ? 'token' : 'tokens'} per execution`;
}

/**
 * One sentence on what the plotted lines are made of: the same executions as the headline saving. The slopes
 * are read off the series (`increments`), never from the all-sample means, which the saving panel shows.
 */
export function plottedBasisSentence(
  report: EconomicsReport,
  increments: { baseline: number; bigforge: number } | null,
): string {
  const { basis } = report.perExecution;
  const baseline = increments ? formatTokens(Math.round(increments.baseline)) : null;
  const bigforge = increments ? formatTokens(Math.round(increments.bigforge)) : null;
  if (basis === 'shadow_estimate') {
    return `There is no live execution yet, so both lines use sample means${baseline && bigforge ? ` (${baseline} baseline tokens against ${bigforge} through the Reflex per execution)` : ''}: a shadow estimate.`;
  }
  if (basis !== 'measured_reference' && basis !== 'counterfactual_estimate') return '';
  const n = report.reuse.verifiedLive;
  const what =
    basis === 'measured_reference'
      ? 'measured executions'
      : 'live executions (the baseline estimated where no reference ran)';
  const spent =
    baseline && bigforge
      ? `: the baseline ${n === 1 ? 'spent' : 'averaged'} ${baseline} tokens where the Reflex ${n === 1 ? 'spent' : 'averaged'} ${bigforge}`
      : '';
  return `Both lines use the same ${what} as the headline saving (${plural(n, 'execution')}${spent}); the mean over all ${plural(report.baseline.samples, 'baseline sample')} (${formatTokens(report.baseline.meanTokens)} tokens) is in the saving panel.`;
}

/**
 * Why the plotted lines cross somewhere other than the report's break-even. Null when they agree (within
 * the rounding of one execution), which is the normal case: both are drawn on the headline saving's basis.
 */
export function explainBreakEvenGap(report: EconomicsReport, gap: BreakEvenGap): string | null {
  if (!gap.differs || gap.reported === null || gap.crossing === null) return null;
  const basis = savingBasisInfo(report.perExecution.basis).label.toLowerCase();
  return `The report says ${formatCount(gap.reported)}: the investment divided by the per-execution saving (${formatTokens(report.perExecution.tokensAvoided)} tokens, ${basis}), rounded up. The plotted lines cross at about ${formatCount(wholeExecutions(gap.crossing))}, which is more than that rounding explains. Treat them as two estimates.`;
}

/** The one-line summary of a chart, used as its accessible name. */
export function breakEvenAriaLabel(
  report: EconomicsReport,
  crossing: number | null,
  windowMax: number,
  increments: { baseline: number; bigforge: number } | null,
): string {
  const crossingText =
    crossing === null
      ? 'The lines do not cross within the visible range'
      : `The lines cross at about ${formatCount(wholeExecutions(crossing))} executions`;
  const baseline = increments
    ? `the baseline rises by ${formatTokens(Math.round(increments.baseline))} tokens per execution`
    : 'the baseline rises with every execution';
  return `Cumulative tokens against executions up to ${formatCount(windowMax)}: ${baseline} while BigForge starts at its ${formatTokens(report.investment.totalTokens)}-token investment ${describeBigforgeIncrement(increments?.bigforge ?? null)}. ${crossingText}.`;
}
