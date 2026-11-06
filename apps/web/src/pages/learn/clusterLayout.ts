import type { FamiliesViewDto, FamilyNodeDto } from '@bigforge/schemas';

/**
 * Deterministic layout of the families map. Pure: the same view always yields the same coordinates
 * (no force simulation, no randomness). Tasks are grouped by family; tasks that belong to no family sit
 * apart in an "unmatched" zone. Inside a family the tasks follow a Vogel (sunflower) spiral ordered by how
 * similar each one is to the rest of the family, so "closer to the centre" means "more typical".
 */

type MapInput = Pick<FamiliesViewDto, 'families' | 'nodes' | 'edges'>;

export const UNMATCHED_ID = '__unmatched__';
export const NODE_RADIUS = 16;

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));
const SPACING = 30;
const CLUSTER_PAD = 22;
const LABEL_H = 30;
const MARGIN = 20;
const MIN_GAP = 28;
const GRID_CELL = NODE_RADIUS * 2 + 22;

export interface MapNode extends FamilyNodeDto {
  /** The cluster it is drawn in: a family id or `UNMATCHED_ID`. */
  clusterId: string;
  x: number;
  y: number;
  r: number;
  /** One of the tasks the family was discovered from (and a source trace of its Reflex). */
  learned: boolean;
  /** Mean similarity to the other tasks of its family; null outside a family or when alone. */
  affinity: number | null;
}

export interface MapCluster {
  id: string;
  kind: 'family' | 'unmatched';
  label: string;
  /** Bounding box including the label strip above. */
  x: number;
  y: number;
  width: number;
  height: number;
  /** Centre and radius of the family disc (zero radius for the unmatched zone). */
  cx: number;
  cy: number;
  radius: number;
  nodeIds: string[];
  variantCount: number;
}

export interface MapEdge {
  a: string;
  b: string;
  score: number;
}

export interface MapLayout {
  width: number;
  height: number;
  nodes: MapNode[];
  clusters: MapCluster[];
  /** The maximum-similarity spanning forest of each family: the sparse backbone drawn by default. */
  backbone: MapEdge[];
}

const collator = new Intl.Collator('en', { numeric: true });
export const compareScenarioIds = (a: string, b: string): number => collator.compare(a, b);

const round1 = (value: number): number => Math.round(value * 10) / 10;
const round3 = (value: number): number => Math.round(value * 1000) / 1000;
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** Strongest edges of one task (highest similarity first, ties by id), for the neighbour list. */
export function strongestNeighbours(
  edges: readonly MapEdge[],
  taskId: string,
  limit: number,
): { taskId: string; score: number }[] {
  return edges
    .filter((edge) => edge.a === taskId || edge.b === taskId)
    .map((edge) => ({ taskId: edge.a === taskId ? edge.b : edge.a, score: edge.score }))
    .sort((p, q) => q.score - p.score || (p.taskId < q.taskId ? -1 : 1))
    .slice(0, limit);
}

function maxSpanningForest(nodeIds: readonly string[], edges: readonly MapEdge[]): MapEdge[] {
  const parent = new Map(nodeIds.map((id) => [id, id]));
  const find = (id: string): string => {
    let root = id;
    for (;;) {
      const up = parent.get(root);
      if (up === undefined || up === root) break;
      root = up;
    }
    return root;
  };
  const kept: MapEdge[] = [];
  const sorted = [...edges].sort((p, q) => {
    const kp = pairKey(p.a, p.b);
    const kq = pairKey(q.a, q.b);
    return q.score - p.score || (kp < kq ? -1 : kp > kq ? 1 : 0);
  });
  for (const edge of sorted) {
    const ra = find(edge.a);
    const rb = find(edge.b);
    if (ra === rb) continue;
    parent.set(ra, rb);
    kept.push(edge);
  }
  return kept;
}

interface MapNodeDraft extends FamilyNodeDto {
  learned: boolean;
  affinity: number | null;
}

interface Placed {
  id: string;
  kind: 'family' | 'unmatched';
  label: string;
  nodes: { id: string; x: number; y: number }[];
  width: number;
  height: number;
  /** Centre of the disc relative to the item's top-left. */
  cx: number;
  cy: number;
  radius: number;
  variantCount: number;
}

function placeFamily(
  id: string,
  label: string,
  ordered: readonly MapNodeDraft[],
  variantCount: number,
): Placed {
  let reach = 0;
  const spiral = ordered.map((node, index) => {
    const distance = SPACING * Math.sqrt(index + 0.5);
    reach = Math.max(reach, distance);
    const angle = index * GOLDEN_ANGLE;
    return { id: node.taskId, x: distance * Math.cos(angle), y: distance * Math.sin(angle) };
  });
  const radius = Math.max(64, reach + NODE_RADIUS + CLUSTER_PAD);
  return {
    id,
    kind: 'family',
    label,
    nodes: spiral.map((n) => ({ id: n.id, x: n.x + radius, y: n.y + radius + LABEL_H })),
    width: radius * 2,
    height: radius * 2 + LABEL_H,
    cx: radius,
    cy: radius + LABEL_H,
    radius,
    variantCount,
  };
}

function placeUnmatched(ordered: readonly MapNodeDraft[], variantCount: number): Placed {
  const columns = Math.max(1, Math.min(4, Math.ceil(Math.sqrt(ordered.length))));
  const rows = Math.ceil(ordered.length / columns);
  return {
    id: UNMATCHED_ID,
    kind: 'unmatched',
    label: 'Not in a family',
    nodes: ordered.map((node, index) => ({
      id: node.taskId,
      x: CLUSTER_PAD + (index % columns) * GRID_CELL + GRID_CELL / 2 - 11,
      y: LABEL_H + CLUSTER_PAD + Math.floor(index / columns) * GRID_CELL + GRID_CELL / 2 - 11,
    })),
    width: Math.max(columns * GRID_CELL + CLUSTER_PAD * 2 - 22, 190),
    height: rows * GRID_CELL + CLUSTER_PAD * 2 - 22 + LABEL_H,
    cx: 0,
    cy: LABEL_H,
    radius: 0,
    variantCount,
  };
}

export interface LayoutOptions {
  /** Width of the drawing area in px. Clusters are spread across it; it never shrinks below the content. */
  width?: number;
}

export function layoutFamilyMap(view: MapInput, options: LayoutOptions = {}): MapLayout {
  const scores = new Map<string, number>();
  for (const edge of view.edges) scores.set(pairKey(edge.a, edge.b), edge.score);

  const learned = new Set(view.families.flatMap((f) => f.members.map((m) => m.taskId)));
  const familyIds = new Set(view.families.map((f) => f.id));
  const byCluster = new Map<string, FamilyNodeDto[]>();
  for (const node of view.nodes) {
    const clusterId =
      node.familyId !== null && familyIds.has(node.familyId) ? node.familyId : UNMATCHED_ID;
    const list = byCluster.get(clusterId);
    if (list) list.push(node);
    else byCluster.set(clusterId, [node]);
  }

  const drafts = (clusterId: string): MapNodeDraft[] => {
    const members = byCluster.get(clusterId) ?? [];
    return members
      .map((node): MapNodeDraft => {
        const others = members.filter((m) => m.taskId !== node.taskId);
        const affinity =
          clusterId === UNMATCHED_ID || others.length === 0
            ? null
            : round3(
                others.reduce(
                  (sum, m) => sum + (scores.get(pairKey(node.taskId, m.taskId)) ?? 0),
                  0,
                ) / others.length,
              );
        return { ...node, learned: learned.has(node.taskId), affinity };
      })
      .sort(
        (p, q) =>
          (q.affinity ?? -1) - (p.affinity ?? -1) ||
          Number(q.learned) - Number(p.learned) ||
          compareScenarioIds(p.scenarioId, q.scenarioId) ||
          (p.taskId < q.taskId ? -1 : 1),
      );
  };

  const variantCountOf = (list: readonly FamilyNodeDto[]): number =>
    new Set(list.map((n) => n.variantKey)).size;

  const placed: Placed[] = [];
  const draftById = new Map<string, MapNodeDraft>();
  const familyOrder = [...view.families]
    .filter((f) => (byCluster.get(f.id)?.length ?? 0) > 0)
    .sort(
      (p, q) =>
        (byCluster.get(q.id)?.length ?? 0) - (byCluster.get(p.id)?.length ?? 0) ||
        (p.id < q.id ? -1 : 1),
    );
  for (const family of familyOrder) {
    const ordered = drafts(family.id);
    for (const d of ordered) draftById.set(d.taskId, d);
    placed.push(placeFamily(family.id, family.name, ordered, variantCountOf(ordered)));
  }
  const unmatched = drafts(UNMATCHED_ID);
  for (const d of unmatched) draftById.set(d.taskId, d);
  if (unmatched.length > 0) placed.push(placeUnmatched(unmatched, variantCountOf(unmatched)));

  // Shelf packing: left to right, wrap when the next cluster would overflow; spread each shelf evenly.
  const innerWidth = Math.max((options.width ?? 0) - MARGIN * 2, 0);
  const shelves: Placed[][] = [];
  let shelf: Placed[] = [];
  let used = 0;
  for (const item of placed) {
    const need = item.width + (shelf.length > 0 ? MIN_GAP : 0);
    if (shelf.length > 0 && used + need > innerWidth) {
      shelves.push(shelf);
      shelf = [];
      used = 0;
    }
    used += item.width + (shelf.length > 0 ? MIN_GAP : 0);
    shelf.push(item);
  }
  if (shelf.length > 0) shelves.push(shelf);

  const contentWidth = Math.max(
    innerWidth,
    ...shelves.map((s) => s.reduce((sum, item) => sum + item.width, 0) + MIN_GAP * (s.length - 1)),
    0,
  );

  const nodes: MapNode[] = [];
  const clusters: MapCluster[] = [];
  let cursorY = MARGIN;
  for (const row of shelves) {
    const rowWidth = row.reduce((sum, item) => sum + item.width, 0);
    const gap = Math.max(MIN_GAP, (contentWidth - rowWidth) / (row.length + 1));
    const rowHeight = Math.max(...row.map((item) => item.height));
    let cursorX = MARGIN + gap;
    for (const item of row) {
      const top = cursorY + (rowHeight - item.height) / 2;
      for (const placedNode of item.nodes) {
        const draft = draftById.get(placedNode.id);
        if (!draft) continue;
        nodes.push({
          ...draft,
          clusterId: item.id,
          x: round1(cursorX + placedNode.x),
          y: round1(top + placedNode.y),
          r: NODE_RADIUS,
        });
      }
      clusters.push({
        id: item.id,
        kind: item.kind,
        label: item.label,
        x: round1(cursorX),
        y: round1(top),
        width: round1(item.width),
        height: round1(item.height),
        cx: round1(cursorX + item.cx),
        cy: round1(top + item.cy),
        radius: round1(item.radius),
        nodeIds: item.nodes.map((n) => n.id),
        variantCount: item.variantCount,
      });
      cursorX += item.width + gap;
    }
    cursorY += rowHeight + MIN_GAP;
  }

  const backbone: MapEdge[] = [];
  for (const cluster of clusters) {
    if (cluster.kind !== 'family') continue;
    const inside = new Set(cluster.nodeIds);
    backbone.push(
      ...maxSpanningForest(
        cluster.nodeIds,
        view.edges.filter((e) => inside.has(e.a) && inside.has(e.b)),
      ),
    );
  }

  return {
    width: Math.ceil(contentWidth + MARGIN * 2),
    height: Math.ceil(Math.max(cursorY - MIN_GAP + MARGIN, MARGIN * 2)),
    nodes,
    clusters,
    backbone,
  };
}
