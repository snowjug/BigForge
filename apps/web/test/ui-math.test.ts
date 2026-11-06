import { describe, expect, it } from 'vitest';
import { arcPoint, clamp01, toRatio } from '../src/ui/gauge';
import { computePosition } from '../src/ui/positioning';
import { provenanceList } from '../src/ui/provenance';
import { sparklineGeometry } from '../src/ui/sparkline';

const viewport = { width: 1000, height: 700 };
const floating = { width: 200, height: 80 };

describe('computePosition', () => {
  it('centres a bottom placement under the anchor', () => {
    const result = computePosition({
      anchor: { x: 400, y: 100, width: 100, height: 30 },
      floating,
      viewport,
      side: 'bottom',
    });
    expect(result).toEqual({ x: 350, y: 138, side: 'bottom' });
  });

  it('flips to the opposite side when there is no room', () => {
    const result = computePosition({
      anchor: { x: 400, y: 640, width: 100, height: 30 },
      floating,
      viewport,
      side: 'bottom',
    });
    expect(result.side).toBe('top');
    expect(result.y).toBe(640 - 8 - 80);
  });

  it('keeps the floating box inside the viewport horizontally', () => {
    const left = computePosition({
      anchor: { x: 0, y: 100, width: 20, height: 20 },
      floating,
      viewport,
      side: 'bottom',
    });
    expect(left.x).toBe(8);
    const right = computePosition({
      anchor: { x: 980, y: 100, width: 20, height: 20 },
      floating,
      viewport,
      side: 'bottom',
    });
    expect(right.x).toBe(1000 - 200 - 8);
  });

  it('supports start and end alignment and the side placements', () => {
    const anchor = { x: 400, y: 300, width: 100, height: 30 };
    expect(computePosition({ anchor, floating, viewport, side: 'bottom', align: 'start' }).x).toBe(
      400,
    );
    expect(computePosition({ anchor, floating, viewport, side: 'bottom', align: 'end' }).x).toBe(
      300,
    );
    const right = computePosition({ anchor, floating, viewport, side: 'right' });
    expect(right).toEqual({ x: 508, y: 275, side: 'right' });
    const left = computePosition({ anchor, floating, viewport, side: 'left' });
    expect(left).toEqual({ x: 192, y: 275, side: 'left' });
  });

  it('chooses the roomier side when neither fits', () => {
    const result = computePosition({
      anchor: { x: 400, y: 300, width: 100, height: 30 },
      floating: { width: 200, height: 600 },
      viewport,
      side: 'top',
    });
    expect(['top', 'bottom']).toContain(result.side);
    expect(result.y).toBeGreaterThanOrEqual(8);
  });
});

describe('gauge maths', () => {
  it('clamps and maps values to ratios', () => {
    expect(clamp01(-1)).toBe(0);
    expect(clamp01(2)).toBe(1);
    expect(toRatio(5, 0, 10)).toBe(0.5);
    expect(toRatio(15, 0, 10)).toBe(1);
    expect(toRatio(0.943)).toBeCloseTo(0.943);
    expect(toRatio(1, 3, 3)).toBe(0);
    expect(toRatio(Number.NaN)).toBe(0);
  });

  it('places the threshold tick along the semicircle', () => {
    expect(arcPoint(0, 50, 60, 60)).toEqual({ x: 10, y: 60 });
    expect(arcPoint(0.5, 50, 60, 60)).toEqual({ x: 60, y: 10 });
    expect(arcPoint(1, 50, 60, 60)).toEqual({ x: 110, y: 60 });
  });
});

describe('sparklineGeometry', () => {
  it('spreads points evenly and inverts the y axis', () => {
    const g = sparklineGeometry({ data: [0, 5, 10], width: 106, height: 26, padding: 3 });
    expect(g.points).toEqual([
      { x: 3, y: 23 },
      { x: 53, y: 13 },
      { x: 103, y: 3 },
    ]);
    expect(g.line).toBe('M3 23 L53 13 L103 3');
    expect(g.area.startsWith(g.line)).toBe(true);
    expect(g.area.endsWith('Z')).toBe(true);
  });

  it('draws a flat series at mid height and a single point in the centre', () => {
    const flat = sparklineGeometry({ data: [4, 4, 4], width: 100, height: 20, padding: 0 });
    expect(new Set(flat.points.map((point) => point.y))).toEqual(new Set([10]));
    const single = sparklineGeometry({ data: [7], width: 100, height: 20 });
    expect(single.line).toBe('');
    expect(single.points).toHaveLength(1);
    expect(single.points[0]?.x).toBe(50);
  });

  it('honours fixed bounds and positions a threshold inside the range only', () => {
    const g = sparklineGeometry({
      data: [0.4, 0.9],
      width: 100,
      height: 23,
      padding: 3,
      min: 0,
      max: 1,
      threshold: 0.5,
    });
    expect(g.thresholdY).toBe(11.5);
    expect(
      sparklineGeometry({ data: [0.4], width: 10, height: 10, min: 0, max: 1, threshold: 2 })
        .thresholdY,
    ).toBeNull();
  });

  it('ignores non-finite values and survives empty input', () => {
    expect(
      sparklineGeometry({ data: [1, Number.NaN, 2], width: 50, height: 20 }).points,
    ).toHaveLength(2);
    const empty = sparklineGeometry({ data: [], width: 50, height: 20 });
    expect(empty.points).toEqual([]);
    expect(empty.line).toBe('');
  });
});

describe('provenanceList', () => {
  it('normalises one or many kinds into display order without duplicates', () => {
    expect(provenanceList('synthetic')).toEqual(['synthetic']);
    expect(provenanceList(['estimated', 'measured', 'estimated'])).toEqual([
      'measured',
      'estimated',
    ]);
    expect(provenanceList(undefined)).toEqual([]);
  });
});
