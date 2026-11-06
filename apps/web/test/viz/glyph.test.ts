import { describe, expect, it } from 'vitest';
import { GLYPH_BOX, GLYPH_STRANDS, glyphFromHash, type GlyphSpec } from '../../src/viz/glyph/glyph';

function sha256ish(seed: number): string {
  let state = seed * 2654435761 + 12345;
  let out = '';
  while (out.length < 64) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out += (state >>> 8).toString(16).padStart(6, '0');
  }
  return out.slice(0, 64);
}

/** Mean absolute difference of strand heights, tops and tones: 0 means identical drawings. */
function distance(a: GlyphSpec, b: GlyphSpec): number {
  let total = 0;
  for (let i = 0; i < a.strands.length; i += 1) {
    const p = a.strands[i]!;
    const q = b.strands[i]!;
    total += Math.abs(p.h - q.h) + Math.abs(p.y - q.y) + (p.tone === q.tone ? 0 : 6);
  }
  return total / a.strands.length;
}

describe('glyphFromHash', () => {
  it('is deterministic: the same hash always draws the same glyph', () => {
    const hash = '4b34a479b92ec5f7028e464b29004c3928a52d850936865f347cca9481cb32f4';
    expect(glyphFromHash(hash)).toEqual(glyphFromHash(hash));
    expect(glyphFromHash(hash.toUpperCase())).toEqual(glyphFromHash(hash));
  });

  it('draws visibly different glyphs for different hashes', () => {
    const glyphs = Array.from({ length: 40 }, (_, i) => glyphFromHash(sha256ish(i + 1)));
    let closest = Infinity;
    for (let i = 0; i < glyphs.length; i += 1) {
      for (let j = i + 1; j < glyphs.length; j += 1) {
        closest = Math.min(closest, distance(glyphs[i]!, glyphs[j]!));
      }
    }
    expect(closest).toBeGreaterThan(2);
    // SHA-256 changes about half of its nibbles, but even one nibble yields a different drawing
    const base = sha256ish(5);
    const tweaked = `${base.slice(0, 20)}${base[20] === 'a' ? 'b' : 'a'}${base.slice(21)}`;
    expect(distance(glyphFromHash(base), glyphFromHash(tweaked))).toBeGreaterThan(0);
  });

  it('keeps every strand inside the drawing box', () => {
    for (let i = 0; i < 60; i += 1) {
      const glyph = glyphFromHash(sha256ish(i));
      expect(glyph.strands).toHaveLength(GLYPH_STRANDS);
      for (const s of glyph.strands) {
        expect(s.x).toBeGreaterThanOrEqual(0);
        expect(s.x + s.w).toBeLessThanOrEqual(GLYPH_BOX);
        expect(s.y).toBeGreaterThanOrEqual(0);
        expect(s.y + s.h).toBeLessThanOrEqual(GLYPH_BOX);
        expect(s.h).toBeGreaterThan(4);
      }
    }
  });

  it('stays calm: one or two ember strands, the rest steel or ash', () => {
    for (let i = 0; i < 60; i += 1) {
      const tones = glyphFromHash(sha256ish(i)).strands.map((s) => s.tone);
      const ember = tones.filter((t) => t === 'ember').length;
      expect(ember).toBeGreaterThanOrEqual(1);
      expect(ember).toBeLessThanOrEqual(2);
      expect(tones.some((t) => t === 'steel')).toBe(true);
    }
  });

  it('accepts short, empty and odd input without throwing', () => {
    for (const input of [
      '',
      'a',
      'abc',
      'not hex at all',
      '🔥 odd input',
      'ff'.repeat(3),
      'x'.repeat(5000),
    ]) {
      const glyph = glyphFromHash(input);
      expect(glyph.strands).toHaveLength(GLYPH_STRANDS);
      expect(glyph.strands.every((s) => Number.isFinite(s.x + s.y + s.w + s.h))).toBe(true);
    }
    expect(glyphFromHash(undefined as unknown as string).strands).toHaveLength(GLYPH_STRANDS);
    expect(distance(glyphFromHash('abc'), glyphFromHash('abd'))).toBeGreaterThan(0);
    expect(distance(glyphFromHash(''), glyphFromHash('a'))).toBeGreaterThan(0);
  });
});
