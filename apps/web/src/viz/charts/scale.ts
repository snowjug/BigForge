/** Pure scale and tick helpers shared by the BigForge charts (unit-tested, no React, no DOM). */

export interface LinearScale {
  (value: number): number;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  /** Pixel back to data value. */
  invert: (pixel: number) => number;
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0;
  const scale = (value: number): number =>
    span === 0 ? (r0 + r1) / 2 : r0 + ((value - d0) / span) * (r1 - r0);
  const invert = (pixel: number): number =>
    r1 === r0 ? d0 : d0 + ((pixel - r0) / (r1 - r0)) * span;
  return Object.assign(scale, { domain, range, invert });
}

const roundTo = (value: number, digits = 10): number => {
  const factor = 10 ** digits;
  // `+ 0` turns a negative zero into a plain zero so no axis ever prints "-0".
  return Math.round(value * factor) / factor + 0;
};

export const round2 = (value: number): number => Math.round(value * 100) / 100;

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** A 1, 2, 5 x 10^n step that yields about `target` intervals across `span`. */
export function niceStep(span: number, target = 5): number {
  if (!(span > 0) || !Number.isFinite(span)) return 1;
  const raw = span / Math.max(1, target);
  const power = 10 ** Math.floor(Math.log10(raw));
  const fraction = raw / power;
  const nice = fraction < 1.5 ? 1 : fraction < 3 ? 2 : fraction < 7 ? 5 : 10;
  return nice * power;
}

/** Evenly spaced round ticks inside [min, max]. A degenerate range yields its single value. */
export function niceTicks(min: number, max: number, target = 5): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (!(max > min)) return [min];
  const step = niceStep(max - min, target);
  const first = Math.ceil(min / step - 1e-9) * step;
  const ticks: number[] = [];
  for (let value = first; value <= max + step * 1e-9; value += step) ticks.push(roundTo(value));
  return ticks;
}

/** The smallest round multiple at or above `value`, so the last tick can sit exactly on the domain edge. */
export function niceCeil(value: number, target = 5): number {
  if (!(value > 0) || !Number.isFinite(value)) return 1;
  const step = niceStep(value, target);
  return roundTo(Math.ceil(value / step - 1e-9) * step);
}

/** The largest multiple of `step` at or below `value` (for a lower axis bound). */
export function niceFloor(value: number, step: number): number {
  return roundTo(Math.floor(value / step + 1e-9) * step);
}

/** `M x y L x y ...` through the points, or an empty string for fewer than two. */
export function polylinePath(points: readonly { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  return points
    .map((point, index) => `${index === 0 ? 'M' : 'L'}${round2(point.x)} ${round2(point.y)}`)
    .join(' ');
}

/** A closed polygon through `upper` (left to right) then `lower` (right to left). */
export function bandPath(
  upper: readonly { x: number; y: number }[],
  lower: readonly { x: number; y: number }[],
): string {
  if (upper.length < 2 || lower.length < 2) return '';
  const forward = upper.map((p) => `${round2(p.x)} ${round2(p.y)}`);
  const back = [...lower].reverse().map((p) => `${round2(p.x)} ${round2(p.y)}`);
  return `M${forward.join(' L')} L${back.join(' L')} Z`;
}

/** Evenly spaced values from `from` to `to`, inclusive (at least two). */
export function samples(from: number, to: number, count: number): number[] {
  const n = Math.max(2, Math.round(count));
  return Array.from({ length: n }, (_, index) => from + ((to - from) * index) / (n - 1));
}
