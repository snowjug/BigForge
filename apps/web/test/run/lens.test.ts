import type { BoundaryResolution, ExecSummary, RunDetailDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  chunkName,
  layoutLens,
  outcomeInfo,
  verdictPath,
  withheldRatio,
} from '../../src/viz/exec/lens';
import reflexJson from './fixtures/k1-reflex-run.json';

const run = reflexJson as unknown as RunDetailDto;
const boundary = (run.exec as ExecSummary).boundaries[0] as BoundaryResolution;

describe('layoutLens', () => {
  const layout = layoutLens(boundary, { width: 860, height: 300 });

  it('shows every observed chunk and marks the few that were selected', () => {
    expect(layout.chunks).toHaveLength(15);
    const selected = layout.chunks.filter((chunk) => chunk.state === 'selected');
    expect(selected.map((chunk) => chunk.id).sort()).toEqual(['ev10', 'ev6', 'ev8', 'ev9']);
    expect(layout.observedTokens).toBe(3541);
    expect(layout.selectedTokens).toBe(115);
    expect(layout.withheldTokens).toBe(3426);
    expect(withheldRatio(layout)).toBeCloseTo(0.9675, 3);
  });

  it('keeps the blob circles apart and inside their region', () => {
    const { blobBox } = layout;
    for (const chunk of layout.chunks) {
      const { cx, cy, r } = chunk.blob;
      expect(cx - r).toBeGreaterThanOrEqual(blobBox.x - 1e-6);
      expect(cx + r).toBeLessThanOrEqual(blobBox.x + blobBox.w + 1e-6);
      expect(cy - r).toBeGreaterThanOrEqual(blobBox.y - 1e-6);
      expect(cy + r).toBeLessThanOrEqual(blobBox.y + blobBox.h + 1e-6);
    }
    for (let a = 0; a < layout.chunks.length; a += 1) {
      for (let b = a + 1; b < layout.chunks.length; b += 1) {
        const first = layout.chunks[a]?.blob;
        const second = layout.chunks[b]?.blob;
        if (first && second)
          expect(Math.hypot(first.cx - second.cx, first.cy - second.cy)).toBeGreaterThanOrEqual(
            first.r + second.r,
          );
      }
    }
  });

  it('sizes bubbles by tokens: more tokens, larger radius', () => {
    const byTokens = [...layout.chunks].sort((a, b) => a.tokens - b.tokens);
    for (let index = 1; index < byTokens.length; index += 1) {
      const smaller = byTokens[index - 1];
      const larger = byTokens[index];
      if (smaller && larger) expect(larger.blob.r).toBeGreaterThanOrEqual(smaller.blob.r - 1e-9);
    }
  });

  it('places the selected chunks inside the lens, magnified, and the rest nowhere', () => {
    for (const chunk of layout.chunks) {
      if (chunk.state === 'selected') {
        expect(chunk.lens).not.toBeNull();
        const circle = chunk.lens;
        if (!circle) continue;
        expect(
          Math.hypot(circle.cx - layout.lens.cx, circle.cy - layout.lens.cy) + circle.r,
        ).toBeLessThanOrEqual(layout.lens.r);
        expect(circle.r).toBeGreaterThan(chunk.blob.r);
      } else {
        expect(chunk.lens).toBeNull();
      }
    }
    expect(layout.magnification).toBeGreaterThan(1.5);
  });

  it('carries the reasons and the screening findings', () => {
    const rejected = layout.chunks.find((chunk) => chunk.id === 'ev1');
    expect(rejected?.state).toBe('rejected');
    expect(rejected?.reason).toContain('not needed by the open question');
    expect(rejected?.screening).toBe('redacted');
    const kept = layout.chunks.find((chunk) => chunk.id === 'ev6');
    expect(kept?.reason).toContain('satisfies selector');
    expect(kept?.screening).toBe('clean');
  });

  it('is deterministic', () => {
    expect(layoutLens(boundary, { width: 860, height: 300 })).toEqual(layout);
  });

  it('still lays out at a narrow width', () => {
    const narrow = layoutLens(boundary, { width: 640, height: 300 });
    expect(narrow.chunks.every((chunk) => chunk.blob.r > 0)).toBe(true);
    expect(narrow.chunks.filter((chunk) => chunk.lens).length).toBe(4);
  });
});

describe('chunk names and numbers', () => {
  it('shortens an evidence source to what a bubble can show', () => {
    expect(chunkName('ci-log')).toBe('ci-log');
    expect(chunkName('file:packages/security/src/token.ts')).toBe('token.ts');
    expect(chunkName('export:signToken')).toBe('signToken');
    expect(chunkName('error:packages/auth')).toBe('error');
    expect(chunkName('call-site:packages/auth/src/session.ts')).toBe('call-site');
    expect(chunkName('diagnostic:packages/auth')).toBe('diagnostic');
  });

  it('numbers the selected chunks in the order the call record lists them', () => {
    const layout = layoutLens(boundary, { width: 860, height: 300 });
    const selected = layout.chunks.filter((chunk) => chunk.state === 'selected');
    expect(selected.map((chunk) => chunk.n).sort()).toEqual([1, 2, 3, 4]);
    expect(
      layout.chunks
        .filter((chunk) => chunk.state === 'rejected')
        .every((chunk) => chunk.n === null),
    ).toBe(true);
    const order = boundary.decision.selected.map((chunk) => chunk.id);
    for (const chunk of selected) expect(order.indexOf(chunk.id) + 1).toBe(chunk.n);
  });

  it('leaves room under the lens for its caption', () => {
    const layout = layoutLens(boundary, { width: 860, height: 300 });
    expect(layout.lens.cy + layout.lens.r).toBeLessThanOrEqual(300 - 30);
  });
});

describe('verdictPath and outcomeInfo', () => {
  it('lists the verdicts reached, ending with the final one', () => {
    expect(verdictPath(boundary.decision)).toEqual([
      'REDUCE_CONTEXT',
      'USE_SMALLER_MODEL',
      'ALLOW',
    ]);
    expect(verdictPath({ path: ['REDUCE_CONTEXT'], verdict: 'ALLOW' })).toEqual([
      'REDUCE_CONTEXT',
      'ALLOW',
    ]);
    expect(verdictPath({ path: [], verdict: 'DENY' })).toEqual(['DENY']);
  });

  it('names every outcome', () => {
    expect(outcomeInfo('resolved').tone).toBe('jade');
    expect(outcomeInfo('denied').label).toBe('Denied');
    expect(outcomeInfo('invalid_output').tone).toBe('amber');
    expect(outcomeInfo('provider_error').tone).toBe('crimson');
    expect(outcomeInfo('needs_human').tone).toBe('molten');
  });
});
