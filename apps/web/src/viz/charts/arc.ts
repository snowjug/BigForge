import { clamp, round2 } from './scale';

/**
 * Geometry for semicircular gauges: ratio 0 is the left end, 0.5 the top, 1 the right end
 * (the same convention as the UI kit's Gauge). Pure and unit-tested.
 */

export interface Point {
  x: number;
  y: number;
}

export function polar(ratio: number, radius: number, cx: number, cy: number): Point {
  const angle = Math.PI * (1 - clamp(ratio, 0, 1));
  return { x: round2(cx + radius * Math.cos(angle)), y: round2(cy - radius * Math.sin(angle)) };
}

/** An arc along the top from ratio `from` to ratio `to` (clockwise on screen). Empty when they are equal. */
export function arcPath(from: number, to: number, radius: number, cx: number, cy: number): string {
  const a = clamp(Math.min(from, to), 0, 1);
  const b = clamp(Math.max(from, to), 0, 1);
  if (b - a < 1e-6) return '';
  const start = polar(a, radius, cx, cy);
  const end = polar(b, radius, cx, cy);
  return `M${start.x} ${start.y} A${radius} ${radius} 0 0 1 ${end.x} ${end.y}`;
}

/** A short radial tick across the arc at `ratio`, from `inner` to `outer` radius. */
export function tickLine(
  ratio: number,
  inner: number,
  outer: number,
  cx: number,
  cy: number,
): { from: Point; to: Point } {
  return { from: polar(ratio, inner, cx, cy), to: polar(ratio, outer, cx, cy) };
}
