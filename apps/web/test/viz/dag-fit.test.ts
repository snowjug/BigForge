import type { ReflexSpec } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import specJson from '../../src/viz/fixtures/reflex-spec.json';
import { findImpliedEdges, prepareDag, topologicalIds } from '../../src/viz/forge-graph/dag';
import { fitLayout } from '../../src/viz/forge-graph/fit';
import { layoutDag } from '../../src/viz/forge-graph/layout';

const fixture = specJson as unknown as ReflexSpec;
const PAD = 16;
const OPTS = { nodeW: 160, nodeH: 66, gapX: 40, gapY: 20 };

describe('prepareDag', () => {
  it('keeps the first of duplicate ids and drops dangling, self and repeated dependencies', () => {
    const dag = prepareDag([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a', 'a', 'a', 'missing', 'b'] },
      { id: 'a', dependsOn: ['b'] },
    ]);
    expect(dag.ids).toEqual(['a', 'b']);
    expect(dag.preds).toEqual([[], [0]]);
    expect(dag.layers).toEqual([[0], [1]]);
    expect(dag.brokenEdges).toEqual([]);
  });

  it('breaks cycles deterministically and reports what it dropped', () => {
    const steps = [
      { id: 'a', dependsOn: ['c'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
    ];
    const first = prepareDag(steps);
    expect(first.brokenEdges).toHaveLength(1);
    expect(prepareDag(steps)).toEqual(first);
    expect(first.layers.flat().sort()).toEqual([0, 1, 2]);
  });

  it('assigns the longest-path layer, not the shortest', () => {
    const dag = prepareDag([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
      { id: 'd', dependsOn: ['a', 'c'] },
    ]);
    expect(dag.layer).toEqual([0, 1, 2, 3]);
  });

  it('finds transitive shortcuts only', () => {
    const dag = prepareDag([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a', 'b'] },
      { id: 'd', dependsOn: ['b'] },
    ]);
    const implied = findImpliedEdges(dag);
    expect([...implied]).toEqual([0 * 4 + 2]);
  });

  it('lists steps in layer order for the text summary', () => {
    expect(topologicalIds([['a', 'b'], ['c']])).toEqual(['a', 'b', 'c']);
  });
});

describe('fitLayout', () => {
  const natural = layoutDag(fixture.steps, OPTS);

  it('keeps the natural layout when the container is wide enough', () => {
    const fitted = fitLayout(fixture.steps, OPTS, natural.width + PAD * 2, PAD);
    expect(fitted).toEqual(natural);
  });

  it('folds into rows that fit a mid-size container instead of shrinking', () => {
    for (const available of [1136, 968, 740]) {
      const fitted = fitLayout(fixture.steps, OPTS, available, PAD);
      expect(fitted.width + PAD * 2).toBeLessThanOrEqual(available);
      expect(fitted.height).toBeGreaterThan(natural.height);
      expect(fitted.nodes.every((n) => n.w === 160 && n.h === 66)).toBe(true);
    }
  });

  it('folds into as few rows as possible', () => {
    const rows = (available: number): number => {
      const ys = new Set(fitLayout(fixture.steps, OPTS, available, PAD).nodes.map((n) => n.y));
      return ys.size;
    };
    expect(rows(1136)).toBeLessThanOrEqual(rows(740));
  });

  it('falls back to scrolling when even the narrowest fold does not fit, and never folds TB', () => {
    expect(fitLayout(fixture.steps, OPTS, 358, PAD)).toEqual(natural);
    expect(fitLayout(fixture.steps, OPTS, null, PAD)).toEqual(natural);
    const tb = layoutDag(fixture.steps, { ...OPTS, direction: 'TB' });
    expect(fitLayout(fixture.steps, { ...OPTS, direction: 'TB' }, 300, PAD)).toEqual(tb);
  });
});
