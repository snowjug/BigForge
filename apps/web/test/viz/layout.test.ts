import type { ReflexSpec } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import specJson from '../../src/viz/fixtures/reflex-spec.json';
import { findImpliedEdges, prepareDag } from '../../src/viz/forge-graph/dag';
import { layoutDag, type DagLayout, type LayoutEdge } from '../../src/viz/forge-graph/layout';

const fixture = specJson as unknown as ReflexSpec;

type Steps = { id: string; dependsOn: string[] }[];
const chainOf = (...ids: string[]): Steps =>
  ids.map((id, i) => ({ id, dependsOn: i === 0 ? [] : [ids[i - 1] as string] }));

function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomDag(seed: number, size: number): Steps {
  const rand = mulberry32(seed);
  return Array.from({ length: size }, (_, i) => {
    const dependsOn: string[] = [];
    for (let j = 0; j < i; j += 1) {
      if (rand() < (i - j <= 2 ? 0.35 : 0.08)) dependsOn.push(`n${j}`);
    }
    return { id: `n${i}`, dependsOn };
  });
}

function nodeOf(layout: DagLayout, id: string) {
  const node = layout.nodes.find((n) => n.id === id);
  if (!node) throw new Error(`missing node ${id}`);
  return node;
}

/** True when the open segment a-b passes through the interior of the node box. */
function crossesBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: { x: number; y: number; w: number; h: number },
): boolean {
  const left = box.x + 0.5;
  const right = box.x + box.w - 0.5;
  const top = box.y + 0.5;
  const bottom = box.y + box.h - 0.5;
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return maxX > left && minX < right && maxY > top && minY < bottom;
}

function backboneCollisions(layout: DagLayout): string[] {
  const hits: string[] = [];
  for (const edge of layout.edges) {
    if (edge.implied) continue;
    for (let i = 0; i + 1 < edge.points.length; i += 1) {
      for (const node of layout.nodes) {
        if (node.id === edge.from || node.id === edge.to) continue;
        if (crossesBox(edge.points[i]!, edge.points[i + 1]!, node)) {
          hits.push(`${edge.from}->${edge.to} crosses ${node.id}`);
        }
      }
    }
  }
  return hits;
}

function overlaps(layout: DagLayout): string[] {
  const hits: string[] = [];
  for (let i = 0; i < layout.nodes.length; i += 1) {
    for (let j = i + 1; j < layout.nodes.length; j += 1) {
      const a = layout.nodes[i]!;
      const b = layout.nodes[j]!;
      if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) {
        hits.push(`${a.id} overlaps ${b.id}`);
      }
    }
  }
  return hits;
}

function allFinite(edge: LayoutEdge): boolean {
  return edge.points.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
}

describe('real Reflex fixture', () => {
  it('is a valid compiled spec', async () => {
    const { ReflexSpec: schema } = await import('@bigforge/schemas');
    expect(() => schema.parse(fixture)).not.toThrow();
    expect(fixture.steps.length).toBeGreaterThanOrEqual(8);
  });

  it('layers by longest path and keeps the transitive backbone', () => {
    const dag = prepareDag(fixture.steps);
    const byId = (id: string) => dag.layer[dag.ids.indexOf(id)];
    expect(byId('snapshot')).toBe(0);
    expect(byId('locate')).toBe(2);
    expect(byId('verify')).toBe(8);
    expect(byId('report')).toBe(9);
    const implied = findImpliedEdges(dag);
    const total = dag.succs.reduce((sum, list) => sum + list.length, 0);
    expect(total).toBe(24);
    expect(implied.size).toBe(11);
  });

  it.each([
    ['LR', { direction: 'LR' as const }],
    ['TB', { direction: 'TB' as const, nodeW: 128, nodeH: 56, gapX: 12, gapY: 30 }],
    ['LR folded in 5', { maxLayersPerBand: 5 }],
    ['LR folded in 4', { maxLayersPerBand: 4 }],
    ['LR folded in 3', { maxLayersPerBand: 3 }],
  ])('%s: no overlaps and backbone edges avoid unrelated nodes', (_label, opts) => {
    const layout = layoutDag(fixture.steps, opts);
    expect(layout.nodes).toHaveLength(fixture.steps.length);
    expect(overlaps(layout)).toEqual([]);
    expect(backboneCollisions(layout)).toEqual([]);
    expect(layout.edges.every(allFinite)).toBe(true);
    for (const node of layout.nodes) {
      expect(node.x).toBeGreaterThanOrEqual(0);
      expect(node.y).toBeGreaterThanOrEqual(0);
      expect(node.x + node.w).toBeLessThanOrEqual(layout.width);
      expect(node.y + node.h).toBeLessThanOrEqual(layout.height);
    }
  });

  it('draws every dependency, flagging the implied ones', () => {
    const layout = layoutDag(fixture.steps);
    expect(layout.edges).toHaveLength(24);
    expect(layout.edges.filter((e) => e.implied)).toHaveLength(11);
    expect(layout.edges.find((e) => e.from === 'locate' && e.to === 'verify')?.implied).toBe(true);
    expect(layout.edges.find((e) => e.from === 'normalize' && e.to === 'locate')?.implied).toBe(
      undefined,
    );
  });

  it('folding narrows the drawing and wraps later layers into lower rows', () => {
    const wide = layoutDag(fixture.steps);
    const folded = layoutDag(fixture.steps, { maxLayersPerBand: 5 });
    expect(folded.width).toBeLessThan(wide.width / 1.6);
    expect(nodeOf(folded, 'report').y).toBeGreaterThan(nodeOf(folded, 'locate').y + 66);
    expect(nodeOf(folded, 'report').layer).toBe(9);
    expect(folded.layers).toEqual(wide.layers);
  });
});

describe('layoutDag basics', () => {
  it('handles an empty graph and a single node', () => {
    expect(layoutDag([])).toEqual({ nodes: [], edges: [], width: 0, height: 0, layers: [] });
    const single = layoutDag([{ id: 'only', dependsOn: [] }], { nodeW: 100, nodeH: 40 });
    expect(single.layers).toEqual([['only']]);
    expect(single.edges).toEqual([]);
    expect(single.nodes[0]).toMatchObject({
      id: 'only',
      layer: 0,
      index: 0,
      x: 0,
      y: 0,
      w: 100,
      h: 40,
    });
    expect(single.width).toBe(100);
    expect(single.height).toBe(40);
  });

  it('lays a chain out on one straight line', () => {
    const layout = layoutDag(chainOf('a', 'b', 'c', 'd'));
    expect(layout.layers).toEqual([['a'], ['b'], ['c'], ['d']]);
    const ys = new Set(layout.nodes.map((n) => n.y));
    expect(ys.size).toBe(1);
    const xs = layout.nodes.map((n) => n.x);
    expect([...xs].sort((p, q) => p - q)).toEqual(xs);
    for (const edge of layout.edges) expect(edge.points).toHaveLength(2);
  });

  it('centres a diamond and keeps its branches apart', () => {
    const layout = layoutDag([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['a'] },
      { id: 'd', dependsOn: ['b', 'c'] },
    ]);
    expect(layout.layers.map((l) => [...l].sort())).toEqual([['a'], ['b', 'c'], ['d']]);
    expect(layout.edges).toHaveLength(4);
    const centre = (id: string) => nodeOf(layout, id).y + nodeOf(layout, id).h / 2;
    expect(centre('a')).toBeCloseTo((centre('b') + centre('c')) / 2, 0);
    expect(centre('d')).toBeCloseTo(centre('a'), 0);
    expect(overlaps(layout)).toEqual([]);
  });

  it('places disconnected steps in the first layer without overlap', () => {
    const layout = layoutDag([
      { id: 'x', dependsOn: [] },
      { id: 'y', dependsOn: [] },
      { id: 'z', dependsOn: [] },
    ]);
    expect(layout.layers).toHaveLength(1);
    expect(new Set(layout.nodes.map((n) => n.x)).size).toBe(1);
    expect(overlaps(layout)).toEqual([]);
    expect(layout.edges).toEqual([]);
  });

  it('ignores dangling, duplicate and self dependencies', () => {
    const layout = layoutDag([
      { id: 'a', dependsOn: ['ghost', 'a'] },
      { id: 'b', dependsOn: ['a', 'a', 'nowhere'] },
      { id: 'a', dependsOn: ['b'] },
    ]);
    expect(layout.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(layout.edges.map((e) => `${e.from}>${e.to}`)).toEqual(['a>b']);
  });

  it('breaks cycles without looping and still places every step', () => {
    const layout = layoutDag([
      { id: 'a', dependsOn: ['c'] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
      { id: 'd', dependsOn: ['d', 'c'] },
    ]);
    expect(layout.nodes).toHaveLength(4);
    expect(layout.edges.length).toBeLessThanOrEqual(3);
    expect(layout.edges.every(allFinite)).toBe(true);
    expect(overlaps(layout)).toEqual([]);
  });

  it('is deterministic for identical input', () => {
    const steps = randomDag(7, 24);
    expect(layoutDag(steps)).toEqual(layoutDag(steps));
    expect(layoutDag(steps, { direction: 'TB' })).toEqual(layoutDag(steps, { direction: 'TB' }));
  });

  it('flows downwards in TB: layers are rows and siblings share a row', () => {
    const layout = layoutDag(
      [
        { id: 'a', dependsOn: [] },
        { id: 'b', dependsOn: ['a'] },
        { id: 'c', dependsOn: ['a'] },
      ],
      { direction: 'TB' },
    );
    expect(nodeOf(layout, 'b').y).toBe(nodeOf(layout, 'c').y);
    expect(nodeOf(layout, 'b').y).toBeGreaterThan(nodeOf(layout, 'a').y);
    expect(nodeOf(layout, 'b').x).not.toBe(nodeOf(layout, 'c').x);
  });

  it('routes a shortcut around the middle step, not through it', () => {
    const layout = layoutDag([
      { id: 'a', dependsOn: [] },
      { id: 'b', dependsOn: ['a'] },
      { id: 'c', dependsOn: ['b'] },
      { id: 'side', dependsOn: ['a'] },
      { id: 'd', dependsOn: ['c', 'side'] },
    ]);
    expect(backboneCollisions(layout)).toEqual([]);
    expect(overlaps(layout)).toEqual([]);
  });
});

describe('layoutDag robustness (random graphs)', () => {
  it.each([1, 2, 3, 4, 5, 6])('seed %i: no overlaps, no collisions, folded or not', (seed) => {
    const steps = randomDag(seed, 18 + seed * 3);
    for (const opts of [
      {},
      { direction: 'TB' as const },
      { maxLayersPerBand: 3 },
      { maxLayersPerBand: 4, nodeW: 120, nodeH: 50 },
    ]) {
      const layout = layoutDag(steps, opts);
      expect(overlaps(layout)).toEqual([]);
      expect(backboneCollisions(layout)).toEqual([]);
      expect(layout.edges.every(allFinite)).toBe(true);
      expect(layout.layers.flat().sort()).toEqual(steps.map((s) => s.id).sort());
    }
  });

  it('stays fast and bounded on a large graph', () => {
    const steps = randomDag(99, 220);
    const started = performance.now();
    const layout = layoutDag(steps);
    expect(performance.now() - started).toBeLessThan(4000);
    expect(layout.nodes).toHaveLength(220);
    expect(Number.isFinite(layout.width) && Number.isFinite(layout.height)).toBe(true);
  });
});
