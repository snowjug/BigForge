import { describe, expect, it } from 'vitest';
import {
  BREAK_EVEN_TOLERANCE,
  breakEvenGap,
  breakEvenGeometry,
  chartWindow,
  fitLine,
  seriesIncrements,
  valueAt,
  wholeExecutions,
  xsBetween,
  yDomainMax,
  type SeriesPoint,
} from '../../src/viz/charts/breakEven';
import {
  bandPath,
  linearScale,
  niceCeil,
  niceFloor,
  niceTicks,
  polylinePath,
} from '../../src/viz/charts/scale';
import { barSpan, layoutWaterfall, type WaterfallInput } from '../../src/viz/charts/waterfall';
import { arcPath, polar } from '../../src/viz/charts/arc';

/**
 * The report's series as the engine builds it: both lines are drawn on the basis of the headline saving,
 * i.e. the mean baseline tokens and the mean Reflex tokens of the executions that produced it. The defaults
 * are the real `complete` snapshot: one measured execution where the baseline spent 42,902 tokens and the
 * Reflex 371 (a saving of 42,531), 870,911 invested. The all-sample mean (34,723) is not what is plotted.
 */
function series(
  options: { n?: number; invest?: number; baseline?: number; bigforge?: number } = {},
) {
  const { n = 200, invest = 870_911, baseline = 42_902, bigforge = 371 } = options;
  const steps = Math.max(12, Math.min(n, 40));
  const out: SeriesPoint[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const k = Math.round((i / steps) * n);
    out.push({
      execution: k,
      baselineCumulative: Math.round(k * baseline),
      bigforgeCumulative: Math.round(invest + k * bigforge),
    });
  }
  return out;
}

describe('scale helpers', () => {
  it('maps a domain onto a range and back', () => {
    const scale = linearScale([0, 200], [40, 640]);
    expect(scale(0)).toBe(40);
    expect(scale(200)).toBe(640);
    expect(scale(100)).toBe(340);
    expect(scale.invert(340)).toBe(100);
  });

  it('centres a degenerate domain instead of dividing by zero', () => {
    expect(linearScale([5, 5], [0, 100])(5)).toBe(50);
  });

  it('produces round ticks that stay inside the range', () => {
    expect(niceTicks(0, 7_000_000, 5)).toEqual([0, 1e6, 2e6, 3e6, 4e6, 5e6, 6e6, 7e6]);
    expect(Object.is(niceTicks(0, 10)[0], 0)).toBe(true);
    expect(niceTicks(0, 1, 5)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(niceTicks(3, 3)).toEqual([3]);
  });

  it('rounds an axis maximum up to a round value', () => {
    expect(niceCeil(6_944_659)).toBe(7_000_000);
    expect(niceCeil(66)).toBe(70);
    expect(niceCeil(0)).toBe(1);
    expect(niceFloor(0.43, 0.1)).toBe(0.4);
  });

  it('builds open and closed paths', () => {
    expect(polylinePath([{ x: 0, y: 1 }])).toBe('');
    expect(
      polylinePath([
        { x: 0, y: 1 },
        { x: 2, y: 3.456 },
      ]),
    ).toBe('M0 1 L2 3.46');
    const band = bandPath(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ],
      [
        { x: 0, y: 5 },
        { x: 10, y: 8 },
      ],
    );
    expect(band).toBe('M0 0 L10 0 L10 8 L0 5 Z');
  });
});

describe('break-even geometry', () => {
  it('fits a straight line and reports no residual for linear data', () => {
    const fit = fitLine([
      { x: 0, y: 5 },
      { x: 10, y: 25 },
      { x: 20, y: 45 },
    ]);
    expect(fit?.line).toEqual({ intercept: 5, slope: 2 });
    expect(fit?.maxResidual).toBeCloseTo(0, 9);
    expect(fitLine([{ x: 1, y: 1 }])).toBeNull();
  });

  it('interpolates the series between samples and clamps outside it', () => {
    const s = series();
    expect(valueAt(s, 'baselineCumulative', 0)).toBe(0);
    expect(valueAt(s, 'baselineCumulative', 7.5)).toBeCloseTo(7.5 * 42_902, -1);
    expect(valueAt(s, 'baselineCumulative', 9999)).toBe(s[s.length - 1]?.baselineCumulative);
    expect(xsBetween(s, 0, 12)).toEqual([0, 5, 10, 12]);
  });

  it('finds where the plotted lines cross and the interval around it', () => {
    const geometry = breakEvenGeometry(series(), { low: 39_687, high: 45_375 });
    expect(geometry).not.toBeNull();
    // Both lines use the headline saving's basis, so they cross at investment / saving =
    // 870,911 / (42,902 - 371) = 20.48: the report's break-even of 21 before rounding up.
    expect(geometry?.baseline.slope).toBeCloseTo(42_902, 0);
    expect(geometry?.bigforge.slope).toBeCloseTo(371, 0);
    expect(geometry?.crossing).toBeGreaterThan(20.4);
    expect(geometry?.crossing).toBeLessThan(20.55);
    expect(geometry?.halfSlope).toBe(2844);
    // the interval is the report's own: investment / (saving +- half width)
    expect(geometry?.crossingInterval?.low).toBeCloseTo(870_911 / (42_531 + 2_844), 1);
    expect(geometry?.crossingInterval?.high).toBeCloseTo(870_911 / (42_531 - 2_844), 1);
    expect(geometry?.maxResidual).toBeLessThan(1);
  });

  it('agrees with the reported break-even whatever the two slopes are', () => {
    for (const [baseline, bigforge, invest] of [
      [42_902, 371, 870_911],
      [42_902, 371, 457_045],
      [34_723, 4_723, 870_911],
      [90_000, 0, 12_345],
    ] as const) {
      const geometry = breakEvenGeometry(series({ baseline, bigforge, invest }), {
        low: 0,
        high: 0,
      });
      const reported = Math.ceil(invest / (baseline - bigforge));
      expect(geometry?.crossing).toBeCloseTo(invest / (baseline - bigforge), 2);
      expect(breakEvenGap(geometry, reported).differs).toBe(false);
      expect(wholeExecutions(geometry?.crossing ?? 0)).toBe(reported);
    }
  });

  it('returns no crossing when the baseline never overtakes the investment', () => {
    const geometry = breakEvenGeometry(series({ n: 10 }), { low: 0, high: 0 });
    expect(geometry?.crossing).toBeNull();
    expect(geometry?.crossingInterval).toBeNull();
  });

  it('has no geometry for an empty report', () => {
    const flat = Array.from({ length: 13 }, (_, i) => ({
      execution: i * 5,
      baselineCumulative: 0,
      bigforgeCumulative: 0,
    }));
    expect(breakEvenGeometry(flat, { low: 0, high: 0 })).toBeNull();
    expect(breakEvenGeometry([], { low: 0, high: 0 })).toBeNull();
  });

  it('treats a zero investment as break-even at the first execution', () => {
    const s = series({ invest: 0 });
    expect(breakEvenGeometry(s, { low: 0, high: 0 })?.crossing).toBe(0);
  });

  it('zooms to the early executions only when that actually shows more', () => {
    const geometry = breakEvenGeometry(series(), { low: 39_687, high: 45_375 });
    if (!geometry) throw new Error('geometry expected');
    const focus = chartWindow(geometry, 'focus', 1);
    expect(focus.canFocus).toBe(true);
    expect(focus.xMax).toBe(60);
    expect(chartWindow(geometry, 'horizon', 1).xMax).toBe(200);
    const big = breakEvenGeometry(series({ n: 100_000 }), { low: 39_687, high: 45_375 });
    if (!big) throw new Error('geometry expected');
    expect(chartWindow(big, 'focus', 1).xMax).toBe(60);

    const short = breakEvenGeometry(series({ n: 30 }), { low: 39_687, high: 45_375 });
    if (!short) throw new Error('geometry expected');
    expect(chartWindow(short, 'focus', 1).canFocus).toBe(false);
  });

  it('sizes the y axis to the highest line including the band', () => {
    const geometry = breakEvenGeometry(series(), { low: 39_687, high: 45_375 });
    if (!geometry) throw new Error('geometry expected');
    const top = yDomainMax(geometry, 200);
    expect(top).toBeGreaterThanOrEqual(42_902 * 200 + 2844 * 200);
    expect(top).toBeLessThanOrEqual(10_000_000);
  });

  it('flags a break-even that differs from the plotted crossing by more than the rounding', () => {
    const geometry = breakEvenGeometry(series(), { low: 39_687, high: 45_375 });
    // crossing is 20.48 and the report rounds up, so 21 (and 20) are the same answer
    expect(breakEvenGap(geometry, 21).differs).toBe(false);
    expect(breakEvenGap(geometry, 20).differs).toBe(false);
    expect(breakEvenGap(geometry, 22).differs).toBe(true);
    expect(breakEvenGap(geometry, 19).differs).toBe(true);
    expect(breakEvenGap(geometry, 11).differs).toBe(true);
    expect(breakEvenGap(geometry, null).differs).toBe(false);
    expect(breakEvenGap(null, 21).differs).toBe(false);
  });

  it('allows exactly one execution of rounding in either direction', () => {
    // BigForge flat at 20,000 and a baseline of 1,000 per execution: the lines cross at exactly 20.
    const geometry = breakEvenGeometry(series({ invest: 20_000, baseline: 1_000, bigforge: 0 }), {
      low: 0,
      high: 0,
    });
    expect(geometry?.crossing).toBeCloseTo(20, 6);
    expect(BREAK_EVEN_TOLERANCE).toBe(1);
    expect(breakEvenGap(geometry, 21).differs).toBe(false);
    expect(breakEvenGap(geometry, 19).differs).toBe(false);
    expect(breakEvenGap(geometry, 22).differs).toBe(true);
    expect(breakEvenGap(geometry, 18).differs).toBe(true);
  });

  it('rounds a crossing up to a whole execution like the report, without float noise', () => {
    expect(wholeExecutions(20.477)).toBe(21);
    expect(wholeExecutions(21)).toBe(21);
    expect(wholeExecutions(21.0000001)).toBe(21);
    expect(wholeExecutions(21.01)).toBe(22);
    expect(wholeExecutions(0.2)).toBe(1);
    expect(Object.is(wholeExecutions(0), 0)).toBe(true);
    expect(wholeExecutions(-3)).toBe(0);
  });

  it('reads how fast each plotted line grows from the series itself', () => {
    const real = seriesIncrements(series());
    // the plotted baseline slope is the reference baseline of the measured execution, not the all-sample mean
    expect(real?.baseline).toBeCloseTo(42_902, 0);
    expect(real?.bigforge).toBeCloseTo(371, 0);
    const flat = seriesIncrements(series({ bigforge: 0 }));
    expect(flat?.bigforge).toBeCloseTo(0, 6);
    expect(seriesIncrements([])).toBeNull();
    expect(
      seriesIncrements([
        { execution: 5, baselineCumulative: 1, bigforgeCumulative: 2 },
        { execution: 5, baselineCumulative: 3, bigforgeCumulative: 4 },
      ]),
    ).toBeNull();
  });
});

const line = (
  id: string,
  value: number,
  counted = true,
  provenance = 'synthetic',
): WaterfallInput => ({ id, label: id, value, counted, provenance, note: '', runs: 1 });

describe('investment waterfall layout', () => {
  it('accumulates counted lines into the total and hangs excluded ones after it', () => {
    const layout = layoutWaterfall(
      [
        line('shadow', 457_045),
        line('canary', 413_866),
        line('compile', 0, true, 'measured'),
        line('learning', 176_153, false),
      ],
      { totalLabel: 'Investment' },
    );
    expect(layout.total).toBe(870_911);
    const [shadow, canary, compile, total, learning] = layout.bars;
    expect(shadow).toMatchObject({ kind: 'step', start: 0, end: 457_045 });
    expect(canary).toMatchObject({ kind: 'step', start: 457_045, end: 870_911 });
    expect(compile).toMatchObject({ kind: 'step', start: 870_911, end: 870_911 });
    expect(total).toMatchObject({ kind: 'total', start: 0, end: 870_911, share: 1 });
    expect(learning).toMatchObject({ kind: 'excluded', start: 870_911, end: 1_047_064 });
    expect(layout.domainMax).toBeGreaterThanOrEqual(1_047_064);
  });

  it('shows the share each line has of the total and labels mixed provenance', () => {
    const layout = layoutWaterfall(
      [line('shadow', 0.267), line('review', 12.5, true, 'estimated')],
      { totalLabel: 'Total', totalValue: 12.767 },
    );
    expect(layout.bars[1]?.share).toBeCloseTo(0.979, 2);
    expect(layout.bars[2]?.provenance).toBe('mixed');
  });

  it('keeps a zero-value bar visible as a hairline', () => {
    const scale = linearScale([0, 100], [0, 400]);
    expect(barSpan({ start: 50, end: 50 }, scale)).toEqual({ x: 200, width: 2 });
    expect(barSpan({ start: 0, end: 25 }, scale)).toEqual({ x: 0, width: 100 });
  });

  it('handles an empty ledger', () => {
    const layout = layoutWaterfall([], { totalLabel: 'Investment' });
    expect(layout.total).toBe(0);
    expect(layout.domainMax).toBe(1);
    expect(layout.bars).toHaveLength(1);
  });
});

describe('gauge arcs', () => {
  it('places ratio 0 on the left, 0.5 on top and 1 on the right', () => {
    expect(polar(0, 50, 60, 60)).toEqual({ x: 10, y: 60 });
    expect(polar(0.5, 50, 60, 60)).toEqual({ x: 60, y: 10 });
    expect(polar(1, 50, 60, 60)).toEqual({ x: 110, y: 60 });
  });

  it('draws an arc between two ratios and nothing for an empty span', () => {
    expect(arcPath(0, 1, 50, 60, 60)).toBe('M10 60 A50 50 0 0 1 110 60');
    expect(arcPath(0.4, 0.4, 50, 60, 60)).toBe('');
    expect(arcPath(1, 0, 50, 60, 60)).toBe(arcPath(0, 1, 50, 60, 60));
  });
});
