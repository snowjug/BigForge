import type { ConfidencePoint, DriftCheckDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  buildTimeline,
  linesCoincide,
  parseComparisonLabel,
} from '../../src/viz/charts/agreementTimeline';

const config = { floor: 0.9, dropThreshold: 0.1 };

/** The real confidence history of the drifted snapshot: 12 shadow agreements, then 12 canary comparisons. */
function history(): ConfidencePoint[] {
  const shadow = Array.from({ length: 12 }, (_, i) => ({
    at: `2026-11-06T09:01:${String(10 + i).padStart(2, '0')}.000Z`,
    confidence: 0.9,
    label: 'shadow agree',
  }));
  const canary = [true, true, true, false, true, false, true, true, true, false, true, true].map(
    (agree, i) => ({
      at: `2026-11-06T09:01:${String(40 + i).padStart(2, '0')}.000Z`,
      confidence: 0.8,
      label: `canary ${agree ? 'agree' : 'disagree'}`,
    }),
  );
  return [...shadow, ...canary];
}

function check(overrides: Partial<DriftCheckDto> = {}): DriftCheckDto {
  return {
    id: 'dft_1',
    reflexVersionId: 'rfv_1',
    envVersion: '1.5.0',
    verdict: {
      drift: true,
      samples: 12,
      historicAgreement: 1,
      currentAgreement: 0.75,
      drop: 0.25,
      interval: { low: 0.513, high: 0.895 },
      reasons: [],
    },
    detail: {
      sample: 12,
      pairs: [],
      firstDivergence: [],
      before: { confidence: 0.93, status: 'active' },
      after: { confidence: 0.71, status: 'shadow' },
      transitions: [],
      canaryCost: { tokens: 0, costUsd: 0, provenance: 'synthetic' },
      environmentChange: { from: '1.4.2', to: '1.5.0' },
    },
    createdAt: '2026-11-06T09:01:52.637Z',
    ...overrides,
  };
}

describe('comparison labels', () => {
  it('reads kind and outcome and ignores anything else', () => {
    expect(parseComparisonLabel('shadow agree')).toEqual({ kind: 'shadow', agree: true });
    expect(parseComparisonLabel('canary disagree')).toEqual({ kind: 'canary', agree: false });
    expect(parseComparisonLabel('live agree')).toBeNull();
    expect(parseComparisonLabel('')).toBeNull();
  });
});

describe('agreement timeline', () => {
  it('runs shadow agreement flat at 100% and canary agreement down to 75%', () => {
    const model = buildTimeline({ history: history(), checks: [check()], config });
    expect(model.points).toHaveLength(24);
    const [shadow, canary] = model.groups;
    expect(shadow).toMatchObject({ kind: 'shadow', title: 'Shadow history' });
    expect(shadow?.points.every((p) => p.running === 1)).toBe(true);
    expect(canary).toMatchObject({ kind: 'canary', title: 'Drift Canary', checkId: 'dft_1' });
    const runs = canary?.points.map((p) => Math.round(p.running * 100));
    expect(runs).toEqual([100, 100, 100, 75, 80, 67, 71, 75, 78, 70, 73, 75]);
    // the last running value is the verdict's current agreement
    expect(canary?.points[11]?.running).toBe(0.75);
    expect(canary?.verdict?.currentAgreement).toBe(0.75);
  });

  it('draws the floor and the maximum-drop line the verdict is judged against', () => {
    const model = buildTimeline({ history: history(), checks: [check()], config });
    expect(model.historic).toBe(1);
    expect(model.floor).toBe(0.9);
    expect(model.dropLine).toBeCloseTo(0.9, 9);
    expect(linesCoincide(model)).toBe(true);
    // the axis reaches below the interval's low end
    expect(model.yMin).toBeLessThanOrEqual(0.4);
    expect(model.yMin).toBeGreaterThanOrEqual(0);
  });

  it('keeps the two lines apart when the history was not perfect', () => {
    const verdict = { ...check().verdict, historicAgreement: 0.95 };
    const model = buildTimeline({ history: history(), checks: [check({ verdict })], config });
    expect(model.dropLine).toBeCloseTo(0.85, 9);
    expect(linesCoincide(model)).toBe(false);
  });

  it('marks where the world changed, between the shadow history and the canary', () => {
    const model = buildTimeline({ history: history(), checks: [check()], config });
    expect(model.environmentMarker?.label).toBe('forge-ci 1.4.2 \u2192 1.5.0');
    const lastShadow = model.groups[0]?.points[11];
    const firstCanary = model.groups[1]?.points[0];
    expect(model.environmentMarker?.x).toBeGreaterThan(lastShadow?.x ?? 99);
    expect(model.environmentMarker?.x).toBeLessThan(firstCanary?.x ?? 0);
    // a gap of one unit separates the groups on the x axis
    expect((firstCanary?.x ?? 0) - (lastShadow?.x ?? 0)).toBe(2);
  });

  it('labels a canary that ran without an environment change by its toolchain', () => {
    const quiet = check({
      detail: { ...check().detail, environmentChange: null },
      envVersion: '1.4.2',
    });
    const model = buildTimeline({ history: history(), checks: [quiet], config });
    expect(model.environmentMarker?.label).toBe('canary on forge-ci 1.4.2');
  });

  it('starts a new running agreement for every canary check', () => {
    const later = '2026-11-06T09:03:00.000Z';
    const second = [true, true, true, true].map((agree, i) => ({
      at: `2026-11-06T09:02:${String(10 + i).padStart(2, '0')}.000Z`,
      confidence: 0.9,
      label: `canary ${agree ? 'agree' : 'disagree'}`,
    }));
    const model = buildTimeline({
      history: [...history(), ...second],
      checks: [
        check({
          id: 'dft_2',
          createdAt: later,
          verdict: { ...check().verdict, drift: false, samples: 4, currentAgreement: 1, drop: 0 },
        }),
        check(),
      ],
      config,
    });
    expect(model.groups.map((g) => g.title)).toEqual(['Shadow history', 'Canary 1', 'Canary 2']);
    expect(model.groups[1]?.points).toHaveLength(12);
    expect(model.groups[2]?.points.map((p) => p.running)).toEqual([1, 1, 1, 1]);
    expect(model.groups[2]?.checkId).toBe('dft_2');
  });

  it('copes with no history and with shadow-only history', () => {
    const empty = buildTimeline({ history: [], checks: [], config });
    expect(empty.points).toEqual([]);
    expect(empty.historic).toBeNull();
    expect(empty.dropLine).toBeNull();
    expect(empty.environmentMarker).toBeNull();

    const shadowOnly = buildTimeline({ history: history().slice(0, 12), checks: [], config });
    expect(shadowOnly.groups).toHaveLength(1);
    expect(shadowOnly.historic).toBe(1);
    expect(shadowOnly.environmentMarker).toBeNull();
  });
});
