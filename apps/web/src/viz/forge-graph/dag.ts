/**
 * Pure graph preparation shared by the layout and the component: dependency normalisation,
 * cycle breaking, longest-path layering and transitive reduction. No React, no DOM.
 */

export interface DagStepLike {
  readonly id: string;
  readonly dependsOn: readonly string[];
}

export interface PreparedDag {
  /** Unique step ids in first-seen order (later duplicates are ignored). */
  ids: string[];
  /** Dependencies per node: ascending, unique, free of dangling references, self edges and cycles. */
  preds: number[][];
  /** Dependents per node: ascending. */
  succs: number[][];
  /** Longest-path layer per node (0 for steps without dependencies). */
  layer: number[];
  /** Node indices per layer, ascending by input position. */
  layers: number[][];
  /** Dependencies that were ignored because they would have formed a cycle. */
  brokenEdges: { from: string; to: string }[];
}

function at<T>(array: readonly T[], index: number): T {
  return array[index] as T;
}

/**
 * Normalises raw `dependsOn` data into an acyclic graph and assigns longest-path layers.
 * Unknown ids, duplicates and self references are dropped; edges that close a cycle (found by a
 * deterministic depth-first walk in input order) are dropped too. Never loops, never throws.
 */
export function prepareDag(steps: readonly DagStepLike[]): PreparedDag {
  const ids: string[] = [];
  const indexOf = new Map<string, number>();
  const sources: (readonly string[])[] = [];
  for (const step of steps) {
    if (indexOf.has(step.id)) continue;
    indexOf.set(step.id, ids.length);
    ids.push(step.id);
    sources.push(step.dependsOn);
  }
  const n = ids.length;

  const candidateSuccs: number[][] = Array.from({ length: n }, () => []);
  for (let to = 0; to < n; to += 1) {
    const seen = new Set<number>();
    for (const dep of at(sources, to)) {
      const from = indexOf.get(dep);
      if (from === undefined || from === to || seen.has(from)) continue;
      seen.add(from);
      at(candidateSuccs, from).push(to);
    }
  }
  for (const list of candidateSuccs) list.sort((a, b) => a - b);

  // Iterative DFS: an edge into a node that is still on the stack closes a cycle.
  const brokenEdges: { from: string; to: string }[] = [];
  const dropped = new Set<number>();
  const color = new Uint8Array(n);
  for (let root = 0; root < n; root += 1) {
    if ((color[root] ?? 0) !== 0) continue;
    const stack: { node: number; next: number }[] = [{ node: root, next: 0 }];
    color[root] = 1;
    while (stack.length > 0) {
      const frame = at(stack, stack.length - 1);
      const children = at(candidateSuccs, frame.node);
      if (frame.next >= children.length) {
        color[frame.node] = 2;
        stack.pop();
        continue;
      }
      const child = at(children, frame.next);
      frame.next += 1;
      const state = color[child] ?? 0;
      if (state === 1) {
        dropped.add(frame.node * n + child);
        brokenEdges.push({ from: at(ids, frame.node), to: at(ids, child) });
      } else if (state === 0) {
        color[child] = 1;
        stack.push({ node: child, next: 0 });
      }
    }
  }

  const succs: number[][] = Array.from({ length: n }, () => []);
  const preds: number[][] = Array.from({ length: n }, () => []);
  for (let from = 0; from < n; from += 1) {
    for (const to of at(candidateSuccs, from)) {
      if (dropped.has(from * n + to)) continue;
      at(succs, from).push(to);
      at(preds, to).push(from);
    }
  }
  for (const list of preds) list.sort((a, b) => a - b);

  // Kahn's algorithm: layer = longest path from any source.
  const layer = new Array<number>(n).fill(0);
  const remaining = preds.map((list) => list.length);
  const queue: number[] = [];
  for (let node = 0; node < n; node += 1) if (at(remaining, node) === 0) queue.push(node);
  for (let head = 0; head < queue.length; head += 1) {
    const node = at(queue, head);
    for (const next of at(succs, node)) {
      layer[next] = Math.max(at(layer, next), at(layer, node) + 1);
      remaining[next] = at(remaining, next) - 1;
      if (at(remaining, next) === 0) queue.push(next);
    }
  }

  let depth = 0;
  for (const value of layer) depth = Math.max(depth, value + 1);
  const layers: number[][] = Array.from({ length: depth }, () => []);
  for (let node = 0; node < n; node += 1) at(layers, at(layer, node)).push(node);

  return { ids, preds, succs, layer, layers, brokenEdges };
}

/** Above this size the O(n^2) reachability table is skipped and every edge counts as direct. */
const REDUCTION_LIMIT = 600;

/**
 * Edges that are implied by a longer path (u -> w -> ... -> v alongside u -> v). Returned as
 * `from * n + to` codes over the prepared node indices. Layout and rendering treat these as
 * secondary: the transitive reduction carries the structure, implied edges stay quiet.
 */
export function findImpliedEdges(dag: PreparedDag): Set<number> {
  const n = dag.ids.length;
  const implied = new Set<number>();
  if (n === 0 || n > REDUCTION_LIMIT) return implied;

  const reach: Uint8Array[] = Array.from({ length: n }, () => new Uint8Array(n));
  const byLayerDesc = Array.from({ length: n }, (_, node) => node).sort(
    (a, b) => at(dag.layer, b) - at(dag.layer, a) || a - b,
  );
  for (const node of byLayerDesc) {
    const mine = at(reach, node);
    for (const next of at(dag.succs, node)) {
      mine[next] = 1;
      const theirs = at(reach, next);
      for (let k = 0; k < n; k += 1) if (theirs[k] === 1) mine[k] = 1;
    }
  }

  for (let from = 0; from < n; from += 1) {
    const children = at(dag.succs, from);
    for (const to of children) {
      for (const via of children) {
        if (via !== to && at(reach, via)[to] === 1) {
          implied.add(from * n + to);
          break;
        }
      }
    }
  }
  return implied;
}

/** Visual reading order: layer by layer, then by position within the layer. */
export function topologicalIds(layers: readonly (readonly string[])[]): string[] {
  return layers.flat();
}
