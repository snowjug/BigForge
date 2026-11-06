export interface Pt {
  x: number;
  y: number;
}

function fmt(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

/**
 * Polyline with rounded corners as an SVG path. The radius is limited to half of each adjacent
 * segment, so tight zig-zags stay smooth instead of overlapping.
 */
export function roundedPath(points: readonly Pt[], radius: number): string {
  const first = points[0];
  if (!first) return '';
  let d = `M${fmt(first.x)} ${fmt(first.y)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1] as Pt;
    const cur = points[i] as Pt;
    const next = points[i + 1];
    if (!next) {
      d += `L${fmt(cur.x)} ${fmt(cur.y)}`;
      break;
    }
    const inLen = Math.hypot(cur.x - prev.x, cur.y - prev.y);
    const outLen = Math.hypot(next.x - cur.x, next.y - cur.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r < 0.5) {
      d += `L${fmt(cur.x)} ${fmt(cur.y)}`;
      continue;
    }
    const ax = cur.x - ((cur.x - prev.x) / inLen) * r;
    const ay = cur.y - ((cur.y - prev.y) / inLen) * r;
    const bx = cur.x + ((next.x - cur.x) / outLen) * r;
    const by = cur.y + ((next.y - cur.y) / outLen) * r;
    d += `L${fmt(ax)} ${fmt(ay)}Q${fmt(cur.x)} ${fmt(cur.y)} ${fmt(bx)} ${fmt(by)}`;
  }
  return d;
}

/** Unit direction of the last segment (zero vector for degenerate input). */
export function endDirection(points: readonly Pt[]): Pt {
  const end = points[points.length - 1];
  if (!end) return { x: 0, y: 0 };
  for (let i = points.length - 2; i >= 0; i -= 1) {
    const from = points[i] as Pt;
    const len = Math.hypot(end.x - from.x, end.y - from.y);
    if (len > 0) return { x: (end.x - from.x) / len, y: (end.y - from.y) / len };
  }
  return { x: 0, y: 0 };
}

/** Moves the final point back along its segment by `distance` (the arrowhead covers the gap). */
export function shortenEnd(points: readonly Pt[], distance: number): Pt[] {
  const out = points.map((p) => ({ ...p }));
  const end = out[out.length - 1];
  const prev = out[out.length - 2];
  if (!end || !prev) return out;
  const len = Math.hypot(end.x - prev.x, end.y - prev.y);
  if (len <= distance + 1) return out;
  end.x -= ((end.x - prev.x) / len) * distance;
  end.y -= ((end.y - prev.y) / len) * distance;
  return out;
}

/** Small filled triangle whose tip is `tip`, pointing along `dir`. */
export function arrowHeadPath(tip: Pt, dir: Pt, length = 7, halfWidth = 3.5): string {
  if (dir.x === 0 && dir.y === 0) return '';
  const bx = tip.x - dir.x * length;
  const by = tip.y - dir.y * length;
  const nx = -dir.y * halfWidth;
  const ny = dir.x * halfWidth;
  return `M${fmt(tip.x)} ${fmt(tip.y)}L${fmt(bx + nx)} ${fmt(by + ny)}L${fmt(bx - nx)} ${fmt(by - ny)}Z`;
}
