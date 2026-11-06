export interface CrackGeometry {
  /** The main crack, edge to edge. */
  main: string;
  /** Short hairline branches. */
  branches: string[];
}

/** FNV-1a: stable 32-bit hash of a string. */
function hash32(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small deterministic PRNG (mulberry32): the same seed always draws the same crack. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const r1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Hairline cracks across a node box: a jagged line from the top edge to the bottom edge with a few
 * short branches. Deterministic per `seed` (the step id), so it never changes between renders.
 */
export function crackGeometry(
  seed: string,
  x: number,
  y: number,
  w: number,
  h: number,
): CrackGeometry {
  const rand = prng(hash32(seed));
  const overshoot = 4;
  const startX = x + w * (0.34 + rand() * 0.14);
  const endX = x + w * (0.54 + rand() * 0.14);
  const steps = 7;
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    const baseX = startX + (endX - startX) * t;
    const jitter = i === 0 || i === steps ? 0 : (rand() - 0.5) * 15;
    pts.push({
      x: r1(Math.min(x + w - 3, Math.max(x + 3, baseX + jitter))),
      y: r1(y - overshoot + (h + overshoot * 2) * t),
    });
  }
  const main = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x} ${p.y}`).join('');

  const branches: string[] = [];
  const branchCount = 2 + (rand() > 0.5 ? 1 : 0);
  for (let b = 0; b < branchCount; b += 1) {
    const at = pts[2 + Math.floor(rand() * (steps - 3))] ?? pts[2];
    if (!at) continue;
    const dir = (b % 2 === 0 ? -1 : 1) * (rand() > 0.35 ? 1 : -1) * (b === 0 ? 1 : -1);
    const length = 12 + rand() * 18;
    const mid = {
      x: at.x + dir * length * 0.55,
      y: at.y + (rand() - 0.3) * 9,
    };
    const tip = {
      x: at.x + dir * length,
      y: mid.y + (rand() - 0.2) * 10,
    };
    const clampX = (value: number): number => r1(Math.min(x + w - 2, Math.max(x + 2, value)));
    const clampY = (value: number): number => r1(Math.min(y + h - 2, Math.max(y + 2, value)));
    branches.push(
      `M${at.x} ${at.y}L${clampX(mid.x)} ${clampY(mid.y)}L${clampX(tip.x)} ${clampY(tip.y)}`,
    );
  }
  return { main, branches };
}
