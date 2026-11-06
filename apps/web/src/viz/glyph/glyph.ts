/**
 * Reflex identity glyph geometry: a calm barcode / double helix derived from a content hash.
 * Twelve vertical strands are the rungs between two interlaced sine rails; the hash picks the
 * phase, the twist, the amplitude of every rung and which strands carry colour. Pure and
 * deterministic: the same hash always yields the same strands, different hashes yield visibly
 * different ones. Any string is accepted (short, empty or non-hex input is expanded).
 */

/** The glyph is drawn in a square box of this many units. */
export const GLYPH_BOX = 48;
export const GLYPH_STRANDS = 12;

export type GlyphTone = 'steel' | 'ash' | 'ember';

export interface GlyphStrand {
  /** Left edge, width, top and height in glyph units (rounded to 0.1). */
  x: number;
  y: number;
  w: number;
  h: number;
  tone: GlyphTone;
}

export interface GlyphSpec {
  /** Side of the square drawing box. */
  box: number;
  strands: GlyphStrand[];
  /** The two helix rails through the strand ends, as smooth SVG path data. */
  rails: [string, string];
}

const STRAND_W = 2.2;
const PITCH = 4;
const NIBBLES = 64;
const MIN_RUNG = 5;

function fnv1a(text: string, seed: number): number {
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** 64 nibbles: the hash itself when it is a full hex digest, otherwise a deterministic expansion. */
function nibblesOf(input: string): number[] {
  const text = typeof input === 'string' ? input : '';
  const hex = text.toLowerCase().replace(/[^0-9a-f]/g, '');
  if (hex.length >= NIBBLES) {
    return [...hex.slice(0, NIBBLES)].map((char) => Number.parseInt(char, 16));
  }
  const out: number[] = [];
  let state = fnv1a(text, 0x9e3779b9) || 1;
  while (out.length < NIBBLES) {
    state = (Math.imul(state ^ (state >>> 15), 0x2c1b3c6d) + 0x297a2d39) >>> 0;
    state ^= state >>> 12;
    for (let shift = 0; shift < 32 && out.length < NIBBLES; shift += 4) {
      out.push((state >>> shift) & 15);
    }
  }
  // Keep the real hex digits of a short input visible in the result.
  [...hex].slice(0, 12).forEach((char, i) => {
    out[i] = Number.parseInt(char, 16);
  });
  return out;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Smooth path through the points (Catmull-Rom converted to cubic Béziers). */
function smoothPath(points: readonly { x: number; y: number }[]): string {
  const first = points[0];
  if (!first) return '';
  let d = `M${first.x} ${first.y}`;
  for (let i = 0; i + 1 < points.length; i += 1) {
    const p0 = points[Math.max(0, i - 1)] ?? first;
    const p1 = points[i] ?? first;
    const p2 = points[i + 1] ?? p1;
    const p3 = points[Math.min(points.length - 1, i + 2)] ?? p2;
    const c1 = { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 };
    const c2 = { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 };
    d += `C${round1(c1.x)} ${round1(c1.y)} ${round1(c2.x)} ${round1(c2.y)} ${p2.x} ${p2.y}`;
  }
  return d;
}

export function glyphFromHash(hash: string): GlyphSpec {
  const nib = nibblesOf(hash);
  const at = (i: number): number => nib[i] ?? 0;
  const phase = ((at(36) * 16 + at(37)) / 256) * Math.PI * 2;
  const twist = 0.44 + (at(38) / 15) * 0.4;
  const middle = GLYPH_BOX / 2;

  const rungs = Array.from({ length: GLYPH_STRANDS }, (_, i) => {
    const swing = Math.sin(phase + i * twist);
    const amplitude = 19 * (0.74 + 0.26 * (at(i) / 15));
    const drift = ((at(12 + i) - 7.5) / 7.5) * 1.6;
    // The two rails swap sides where `swing` changes sign: that is the helix crossing.
    const railA = middle + drift - amplitude * swing;
    const railB = middle + drift + amplitude * swing;
    const half = Math.max(Math.abs(railB - railA), MIN_RUNG) / 2;
    const centre = (railA + railB) / 2;
    return { railA, railB, top: centre - half, height: half * 2, accent: at(24 + i) };
  });

  const ranked = rungs
    .map((rung, i) => ({ i, accent: rung.accent }))
    .sort((a, b) => b.accent - a.accent || a.i - b.i);
  const ember = new Set<number>();
  const first = ranked[0];
  const second = ranked[1];
  if (first) ember.add(first.i);
  if (second && second.accent >= 13) ember.add(second.i);

  const strands: GlyphStrand[] = rungs.map((rung, i) => ({
    x: round1(2 + i * PITCH - STRAND_W / 2),
    y: round1(rung.top),
    w: STRAND_W,
    h: round1(rung.height),
    tone: ember.has(i) ? 'ember' : rung.accent >= 6 ? 'steel' : 'ash',
  }));

  const rail = (pick: (rung: (typeof rungs)[number]) => number): string =>
    smoothPath(rungs.map((rung, i) => ({ x: round1(2 + i * PITCH), y: round1(pick(rung)) })));
  return {
    box: GLYPH_BOX,
    strands,
    rails: [rail((rung) => rung.railA), rail((rung) => rung.railB)],
  };
}
