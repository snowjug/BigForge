import { clamp, niceCeil } from './scale';

/** One sample of `EconomicsReport.series`. */
export interface SeriesPoint {
  execution: number;
  baselineCumulative: number;
  bigforgeCumulative: number;
}

export type SeriesKey = 'baselineCumulative' | 'bigforgeCumulative';

/** y = intercept + slope * x */
export interface Line {
  intercept: number;
  slope: number;
}

/** Least-squares line through the points, with the largest deviation from it. Null below two points. */
export function fitLine(
  points: readonly { x: number; y: number }[],
): { line: Line; maxResidual: number } | null {
  const n = points.length;
  if (n < 2) return null;
  const meanX = points.reduce((sum, p) => sum + p.x, 0) / n;
  const meanY = points.reduce((sum, p) => sum + p.y, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (const p of points) {
    sxx += (p.x - meanX) ** 2;
    sxy += (p.x - meanX) * (p.y - meanY);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = meanY - slope * meanX;
  const maxResidual = points.reduce(
    (max, p) => Math.max(max, Math.abs(p.y - (intercept + slope * p.x))),
    0,
  );
  return { line: { intercept, slope }, maxResidual };
}

/** Piecewise-linear value of a series column at `x`, clamped to the series range. */
export function valueAt(series: readonly SeriesPoint[], key: SeriesKey, x: number): number {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last) return 0;
  if (x <= first.execution) return first[key];
  if (x >= last.execution) return last[key];
  for (let index = 1; index < series.length; index += 1) {
    const a = series[index - 1];
    const b = series[index];
    if (!a || !b || x > b.execution) continue;
    const span = b.execution - a.execution;
    return span === 0 ? b[key] : a[key] + ((b[key] - a[key]) * (x - a.execution)) / span;
  }
  return last[key];
}

/** The series' own x values inside [from, to], plus both ends: enough points to draw a piecewise-linear path exactly. */
export function xsBetween(series: readonly SeriesPoint[], from: number, to: number): number[] {
  if (!(to > from)) return [from];
  const inside = series.map((p) => p.execution).filter((x) => x > from && x < to);
  return [from, ...inside, to];
}

export interface BreakEvenGeometry {
  /** The last execution count on the series (the projected volume). */
  horizon: number;
  baseline: Line;
  bigforge: Line;
  /** Largest deviation (tokens) of the series from the straight lines fitted to it. */
  maxResidual: number;
  /** Executions at which the plotted lines cross. Null when the baseline never overtakes BigForge in the horizon. */
  crossing: number | null;
  /** Half-width per execution (tokens) of the 95% band around the baseline line. */
  halfSlope: number;
  /** Where the crossing falls at the band's edges; `high` is null when the slow edge never crosses. */
  crossingInterval: { low: number; high: number | null } | null;
}

/**
 * Geometry of the break-even chart from the report's series and the per-execution interval. Nothing is
 * re-estimated: the lines are the series, the band is the interval's half width spread over executions.
 * Null when the series carries no signal (all zero) or has fewer than two points.
 */
export function breakEvenGeometry(
  series: readonly SeriesPoint[],
  interval: { low: number; high: number },
): BreakEvenGeometry | null {
  const last = series[series.length - 1];
  if (series.length < 2 || !last) return null;
  if (series.every((p) => p.baselineCumulative === 0 && p.bigforgeCumulative === 0)) return null;

  const baselineFit = fitLine(series.map((p) => ({ x: p.execution, y: p.baselineCumulative })));
  const bigforgeFit = fitLine(series.map((p) => ({ x: p.execution, y: p.bigforgeCumulative })));
  if (!baselineFit || !bigforgeFit) return null;
  const { line: baseline } = baselineFit;
  const { line: bigforge } = bigforgeFit;

  const diffs = series.map((p) => p.baselineCumulative - p.bigforgeCumulative);
  let crossing: number | null = null;
  const firstDiff = diffs[0] ?? 0;
  const first = series[0];
  if (first && firstDiff >= 0) {
    crossing = diffs.some((d) => d > 0) ? first.execution : null;
  } else {
    for (let index = 1; index < series.length; index += 1) {
      const before = diffs[index - 1];
      const after = diffs[index];
      const a = series[index - 1];
      const b = series[index];
      if (before === undefined || after === undefined || !a || !b) continue;
      if (before < 0 && after >= 0) {
        crossing = a.execution + ((b.execution - a.execution) * -before) / (after - before);
        break;
      }
    }
  }

  const halfSlope = Math.max(0, (interval.high - interval.low) / 2);
  const gap = bigforge.intercept - baseline.intercept;
  const crossAt = (slope: number): number | null =>
    slope - bigforge.slope > 0 ? Math.max(0, gap / (slope - bigforge.slope)) : null;
  const low = halfSlope > 0 ? crossAt(baseline.slope + halfSlope) : null;
  const high = halfSlope > 0 ? crossAt(baseline.slope - halfSlope) : null;

  return {
    horizon: last.execution,
    baseline,
    bigforge,
    maxResidual: Math.max(baselineFit.maxResidual, bigforgeFit.maxResidual),
    crossing,
    halfSlope,
    crossingInterval: low === null ? null : { low, high },
  };
}

export type ChartWindowMode = 'horizon' | 'focus';

/**
 * The visible executions range. `horizon` shows the whole projection; `focus` zooms to the early
 * executions around break-even and the realized region (the lines are straight, so the zoom is exact).
 */
export function chartWindow(
  geometry: BreakEvenGeometry,
  mode: ChartWindowMode,
  liveExecutions: number,
): { xMax: number; canFocus: boolean } {
  const anchor = Math.max(
    geometry.crossingInterval?.high ?? 0,
    geometry.crossing ?? 0,
    liveExecutions,
    1,
  );
  const focusMax = clamp(niceCeil(anchor * 2.4), Math.min(10, geometry.horizon), geometry.horizon);
  const canFocus = focusMax < geometry.horizon * 0.8;
  return { xMax: mode === 'focus' && canFocus ? focusMax : geometry.horizon, canFocus };
}

/** Top of the y axis for the visible range: the highest line (including the band) plus a little headroom. */
export function yDomainMax(geometry: BreakEvenGeometry, xMax: number): number {
  const { baseline, bigforge, halfSlope } = geometry;
  const top = Math.max(
    baseline.intercept + (baseline.slope + halfSlope) * xMax,
    bigforge.intercept + bigforge.slope * xMax,
    bigforge.intercept,
    1,
  );
  return niceCeil(top * 1.02);
}

export interface BreakEvenGap {
  /** The chart's crossing and the report's break-even disagree by more than rounding. */
  differs: boolean;
  crossing: number | null;
  reported: number | null;
}

/** The report rounds its break-even up to a whole execution, so the plotted crossing may sit up to one below it. */
export const BREAK_EVEN_TOLERANCE = 1;

/**
 * The first whole execution at which BigForge is ahead: the crossing rounded up, like the report's
 * break-even. A hair of float noise is absorbed so an exact crossing at 21 is not shown as 22.
 */
export function wholeExecutions(crossing: number): number {
  return Math.max(0, Math.ceil(crossing - 1e-6));
}

/**
 * The report's break-even is the investment divided by the per-execution saving, rounded up. The series
 * plots both lines on the same basis as that saving (the baseline and Reflex tokens of the executions that
 * produced it), so the lines cross where the report says, up to the rounding. Only a difference beyond that
 * rounding is flagged.
 */
export function breakEvenGap(
  geometry: BreakEvenGeometry | null,
  reported: number | null,
): BreakEvenGap {
  const crossing = geometry?.crossing ?? null;
  return {
    // A hair above one execution absorbs the float noise of interpolating between rounded series points.
    differs:
      crossing !== null &&
      reported !== null &&
      Math.abs(crossing - reported) > BREAK_EVEN_TOLERANCE + 1e-3,
    crossing,
    reported,
  };
}

/**
 * How much each plotted line grows per execution, read from the series itself (first to last point), so
 * text about the lines always matches the picture. Null when the series spans no executions.
 */
export function seriesIncrements(
  series: readonly SeriesPoint[],
): { baseline: number; bigforge: number } | null {
  const first = series[0];
  const last = series[series.length - 1];
  if (!first || !last || last.execution <= first.execution) return null;
  const span = last.execution - first.execution;
  return {
    baseline: (last.baselineCumulative - first.baselineCumulative) / span,
    bigforge: (last.bigforgeCumulative - first.bigforgeCumulative) / span,
  };
}
