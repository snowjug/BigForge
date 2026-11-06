export type NavKey = 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown' | 'Home' | 'End';

export interface NavNode {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  layer: number;
}

export interface NavEdge {
  from: string;
  to: string;
}

export interface NavInput {
  nodes: readonly NavNode[];
  edges: readonly NavEdge[];
  /** Reading order (topological): Home and End jump to its ends, ties are broken by it. */
  order: readonly string[];
  current: string;
  key: NavKey;
  direction: 'LR' | 'TB';
}

const VECTORS: Record<'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown', [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
};

/**
 * Where keyboard focus moves next. Along the flow, arrows go to the nearest *connected* step in
 * that direction; across the flow, to the nearest step of the same layer first. When nothing
 * qualifies the nearest step in that direction is used, and forward/backward keys follow a
 * dependent / dependency even if it sits in another row of a folded layout.
 */
export function nextFocusTarget(input: NavInput): string | null {
  const { nodes, edges, order, current, key, direction } = input;
  if (key === 'Home') return order[0] ?? null;
  if (key === 'End') return order[order.length - 1] ?? null;

  const from = nodes.find((node) => node.id === current);
  if (!from) return order[0] ?? null;
  const [dx, dy] = VECTORS[key];
  const rank = new Map(order.map((id, i) => [id, i] as const));
  const centre = (node: NavNode): [number, number] => [node.x + node.w / 2, node.y + node.h / 2];
  const [fx, fy] = centre(from);

  const connected = new Set<string>();
  const forward = new Set<string>();
  const backward = new Set<string>();
  for (const edge of edges) {
    if (edge.from === current) {
      connected.add(edge.to);
      forward.add(edge.to);
    } else if (edge.to === current) {
      connected.add(edge.from);
      backward.add(edge.from);
    }
  }

  const measure = (node: NavNode): { along: number; cross: number } => {
    const [cx, cy] = centre(node);
    const ox = cx - fx;
    const oy = cy - fy;
    return { along: ox * dx + oy * dy, cross: Math.abs(ox * dy - oy * dx) };
  };
  const best = (
    candidates: readonly NavNode[],
    weight: number,
    requireAhead: boolean,
  ): string | null => {
    let bestId: string | null = null;
    let bestScore = Infinity;
    let bestRank = Infinity;
    for (const node of candidates) {
      if (node.id === current) continue;
      const { along, cross } = measure(node);
      if (requireAhead && along <= 2) continue;
      const score = requireAhead ? along + weight * cross : Math.hypot(along, cross);
      const r = rank.get(node.id) ?? Infinity;
      if (score < bestScore || (score === bestScore && r < bestRank)) {
        bestId = node.id;
        bestScore = score;
        bestRank = r;
      }
    }
    return bestId;
  };

  const isFlowKey =
    direction === 'LR'
      ? key === 'ArrowLeft' || key === 'ArrowRight'
      : key === 'ArrowUp' || key === 'ArrowDown';
  const isForward = key === 'ArrowRight' || key === 'ArrowDown';

  const viaEdge = (): string | null =>
    best(
      nodes.filter((node) => connected.has(node.id)),
      2,
      true,
    );
  const sibling = (): string | null =>
    best(
      nodes.filter((node) => node.layer === from.layer),
      2,
      true,
    );
  const anywhere = (): string | null => best(nodes, 3, true);
  const followFlow = (): string | null => {
    const chain = isForward ? forward : backward;
    return best(
      nodes.filter((node) => chain.has(node.id)),
      0,
      false,
    );
  };

  // Along the flow: connected steps first. Across it: the neighbours in the same layer first.
  return isFlowKey
    ? (viaEdge() ?? anywhere() ?? followFlow())
    : (sibling() ?? viaEdge() ?? anywhere());
}
