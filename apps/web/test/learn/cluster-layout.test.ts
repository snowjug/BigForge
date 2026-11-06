import type { FamiliesViewDto, FamilyNodeDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  NODE_RADIUS,
  UNMATCHED_ID,
  layoutFamilyMap,
  strongestNeighbours,
} from '../../src/pages/learn/clusterLayout';

const node = (
  scenarioId: string,
  familyId: string | null,
  variantKey: string,
  origin: FamilyNodeDto['origin'] = 'intake',
): FamilyNodeDto => ({
  taskId: `tsk_${scenarioId}`,
  scenarioId,
  variantKey,
  title: `Task ${scenarioId}`,
  familyId,
  intent: 'diagnose_build_failure',
  failureType: 'build',
  toolchain: 'forge-ci',
  origin,
});

const ids = ['L1', 'L2', 'L3', 'L4', 'L5', 'S1', 'S10'];
const familyNodes = ids.map((id, i) =>
  node(id, 'fam_a', i % 2 === 0 ? 'missing_dependency@a' : 'missing_export@b'),
);
const noise = [
  node('N2', null, 'out-of-scope', 'noise'),
  node('N5', null, 'out-of-scope', 'noise'),
];

function view(): Pick<FamiliesViewDto, 'families' | 'nodes' | 'edges'> {
  const edges: FamiliesViewDto['edges'] = [];
  for (let i = 0; i < familyNodes.length; i += 1) {
    for (let j = i + 1; j < familyNodes.length; j += 1) {
      const a = familyNodes[i] as FamilyNodeDto;
      const b = familyNodes[j] as FamilyNodeDto;
      edges.push({ a: a.taskId, b: b.taskId, score: a.variantKey === b.variantKey ? 1 : 0.92 });
    }
  }
  return {
    families: [
      {
        id: 'fam_a',
        name: 'Monorepo build failure',
        description: '',
        centroid: {} as FamiliesViewDto['families'][number]['centroid'],
        memberCount: 5,
        members: familyNodes.slice(0, 5).map((n) => ({
          taskId: n.taskId,
          scenarioId: n.scenarioId,
          variantKey: n.variantKey,
          similarityToCentroid: 0.9,
        })),
        variants: ['missing_dependency@a', 'missing_export@b'],
        createdAt: '2026-11-06T00:00:00Z',
        reflexVersionIds: [],
      },
    ],
    nodes: [...familyNodes, ...noise],
    edges,
  };
}

describe('layoutFamilyMap', () => {
  it('is deterministic: the same view gives identical coordinates', () => {
    expect(layoutFamilyMap(view(), { width: 760 })).toEqual(
      layoutFamilyMap(view(), { width: 760 }),
    );
  });

  it('places every task exactly once and keeps tasks from overlapping', () => {
    const layout = layoutFamilyMap(view(), { width: 760 });
    expect(layout.nodes).toHaveLength(familyNodes.length + noise.length);
    expect(new Set(layout.nodes.map((n) => n.taskId)).size).toBe(layout.nodes.length);
    for (let i = 0; i < layout.nodes.length; i += 1) {
      for (let j = i + 1; j < layout.nodes.length; j += 1) {
        const a = layout.nodes[i]!;
        const b = layout.nodes[j]!;
        expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(NODE_RADIUS * 2);
      }
    }
  });

  it('keeps family tasks inside their disc and the unmatched zone apart from it', () => {
    const layout = layoutFamilyMap(view(), { width: 760 });
    const family = layout.clusters.find((c) => c.id === 'fam_a')!;
    const zone = layout.clusters.find((c) => c.id === UNMATCHED_ID)!;
    for (const n of layout.nodes.filter((x) => x.clusterId === 'fam_a')) {
      expect(Math.hypot(n.x - family.cx, n.y - family.cy)).toBeLessThanOrEqual(
        family.radius - NODE_RADIUS + 0.5,
      );
    }
    const overlapX = family.x < zone.x + zone.width && zone.x < family.x + family.width;
    const overlapY = family.y < zone.y + zone.height && zone.y < family.y + family.height;
    expect(overlapX && overlapY).toBe(false);
    for (const n of layout.nodes.filter((x) => x.clusterId === UNMATCHED_ID)) {
      expect(n.x - NODE_RADIUS).toBeGreaterThanOrEqual(zone.x);
      expect(n.x + NODE_RADIUS).toBeLessThanOrEqual(zone.x + zone.width);
    }
  });

  it('puts the most typical tasks nearest the centre of a family', () => {
    const input = view();
    // L1 gets the highest similarity to everything else.
    input.edges = input.edges.map((e) =>
      e.a === 'tsk_L1' || e.b === 'tsk_L1' ? { ...e, score: 1 } : e,
    );
    const layout = layoutFamilyMap(input, { width: 760 });
    const family = layout.clusters.find((c) => c.id === 'fam_a')!;
    const distance = (taskId: string) => {
      const n = layout.nodes.find((x) => x.taskId === taskId)!;
      return Math.hypot(n.x - family.cx, n.y - family.cy);
    };
    const nearest = [...layout.nodes.filter((n) => n.clusterId === 'fam_a')].sort(
      (a, b) => distance(a.taskId) - distance(b.taskId),
    )[0]!;
    expect(nearest.taskId).toBe('tsk_L1');
    expect(nearest.affinity).toBe(1);
  });

  it('marks the discovery members as learned and gives unmatched tasks no affinity', () => {
    const layout = layoutFamilyMap(view(), { width: 760 });
    expect(
      layout.nodes
        .filter((n) => n.learned)
        .map((n) => n.scenarioId)
        .sort(),
    ).toEqual(['L1', 'L2', 'L3', 'L4', 'L5']);
    expect(
      layout.nodes.filter((n) => n.clusterId === UNMATCHED_ID).every((n) => n.affinity === null),
    ).toBe(true);
  });

  it('draws a sparse backbone: a spanning forest inside each family', () => {
    const layout = layoutFamilyMap(view(), { width: 760 });
    expect(layout.backbone).toHaveLength(familyNodes.length - 1);
    const inside = new Set(layout.clusters.find((c) => c.id === 'fam_a')!.nodeIds);
    expect(layout.backbone.every((e) => inside.has(e.a) && inside.has(e.b))).toBe(true);
    // identical-variant pairs (score 1) are chosen before cross-variant pairs
    expect(layout.backbone.filter((e) => e.score === 1).length).toBeGreaterThanOrEqual(2);
  });

  it('spreads clusters across a wider canvas and never shrinks below the content', () => {
    const narrow = layoutFamilyMap(view(), { width: 100 });
    const wide = layoutFamilyMap(view(), { width: 1200 });
    expect(wide.width).toBeGreaterThan(narrow.width);
    expect(narrow.width).toBeGreaterThan(100);
    const gapNarrow = narrow.clusters[1]!.x - (narrow.clusters[0]!.x + narrow.clusters[0]!.width);
    const gapWide = wide.clusters[1]!.x - (wide.clusters[0]!.x + wide.clusters[0]!.width);
    expect(gapWide).toBeGreaterThan(gapNarrow);
  });

  it('handles an empty view and a view with no family', () => {
    expect(layoutFamilyMap({ families: [], nodes: [], edges: [] })).toMatchObject({
      nodes: [],
      clusters: [],
      backbone: [],
    });
    const layout = layoutFamilyMap({ families: [], nodes: noise, edges: [] }, { width: 500 });
    expect(layout.clusters).toHaveLength(1);
    expect(layout.clusters[0]!.kind).toBe('unmatched');
  });
});

describe('strongestNeighbours', () => {
  it('lists the most similar tasks first and respects the limit', () => {
    const edges = [
      { a: 'x', b: 'a', score: 0.9 },
      { a: 'b', b: 'x', score: 0.97 },
      { a: 'x', b: 'c', score: 0.97 },
      { a: 'y', b: 'z', score: 1 },
    ];
    expect(strongestNeighbours(edges, 'x', 2)).toEqual([
      { taskId: 'b', score: 0.97 },
      { taskId: 'c', score: 0.97 },
    ]);
  });
});
