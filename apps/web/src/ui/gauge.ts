/** Pure maths for Meter and Gauge (unit-tested). */

export const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

/** Maps a value in [min, max] to 0..1, clamped. A degenerate range maps to 0. */
export function toRatio(value: number, min = 0, max = 1): number {
  if (!Number.isFinite(value) || max === min) return 0;
  return clamp01((value - min) / (max - min));
}

/**
 * A point on a semicircular gauge arc that runs from the left (ratio 0), over the top, to the right
 * (ratio 1). Used to place the threshold tick.
 */
export function arcPoint(
  ratio: number,
  radius: number,
  centerX: number,
  centerY: number,
): { x: number; y: number } {
  const angle = Math.PI * (1 - clamp01(ratio));
  return {
    x: Math.round((centerX + radius * Math.cos(angle)) * 100) / 100,
    y: Math.round((centerY - radius * Math.sin(angle)) * 100) / 100,
  };
}
