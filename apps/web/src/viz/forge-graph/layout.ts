import type { ReflexStep } from '@bigforge/schemas';
import { findImpliedEdges, prepareDag } from './dag';

export interface LayoutNode {
  id: string;
  /** Longest-path layer (0 = no dependencies). */
  layer: number;
  /** Position within its layer, in reading order (top to bottom for `LR`, left to right for `TB`). */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface LayoutEdge {
  from: string;
  to: string;
  /**
   * Waypoints from the source anchor to the target anchor. Backbone edges are orthogonal (renderers
   * round the corners) and avoid unrelated nodes; implied edges are a sampled arch.
   */
  points: { x: number; y: number }[];
  /**
   * True when a longer path already connects the two steps (a transitive shortcut). The layout is
   * built from the remaining backbone; implied edges only get an arch that may pass behind nodes,
   * so renderers should keep them quiet or show them on demand.
   */
  implied?: boolean;
}

export interface DagLayout {
  nodes: LayoutNode[];
  edges: LayoutEdge[];
  width: number;
  height: number;
  /** Step ids per layer in layout order. */
  layers: string[][];
}

export interface LayoutOptions {
  direction?: 'LR' | 'TB';
  nodeW?: number;
  nodeH?: number;
  /** `LR`: space between columns (edge channels). `TB`: space between siblings. */
  gapX?: number;
  /** `LR`: space between nodes of a column. `TB`: space between rows (edge channels). */
  gapY?: number;
  /**
   * Folds the layers into rows ("bands") of at most this many layers, like wrapped text, so a deep
   * graph fits a narrow container without shrinking. Edges between bands run through the gutter.
   */
  maxLayersPerBand?: number;
}

const DEFAULT_NODE_W = 160;
const DEFAULT_NODE_H = 66;
const DEFAULT_FLOW_GAP = 40;
const DEFAULT_CROSS_GAP = 20;

/** Cross-axis spacing of parallel long-edge tracks inside a layer. */
const TRACK_PITCH = 8;
/** Cross-axis clearance between a node box and a long-edge track passing it. */
const CLEARANCE = 12;
/** Channel space before the first elbow of an edge. */
const ELBOW_SRC = 10;
/** Channel space kept straight before a target, so arrowheads never sit on a corner. */
const ELBOW_DST = 16;
/** Distance between parallel vertical runs inside a channel. */
const ELBOW_PITCH = 5;
const WRAP_EXIT_BASE = 12;
const WRAP_ENTRY_BASE = 18;
const WRAP_PITCH = 5;
const WRAP_CLEARANCE = 22;
const BAND_GAP_MIN = 40;

const EDGE_WEIGHT = 4;
const MAX_SWEEPS = 32;
const MAX_RELAX_ROUNDS = 80;

interface Nb {
  item: number;
  /** Pull strength used when straightening. */
  w: number;
}

interface Segment {
  a: number;
  b: number;
  w: number;
  chain: number;
}

interface Chain {
  from: number;
  to: number;
  items: number[];
}

interface AbsPoint {
  u: number;
  v: number;
}

interface TrackSpan {
  y0: number;
  y1: number;
}

function at<T>(array: readonly T[], index: number): T {
  return array[index] as T;
}

function usable(value: number | undefined, fallback: number, min: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min ? value : fallback;
}

/** Weighted least squares with a non-decreasing constraint (pool adjacent violators). */
function isotonic(targets: readonly number[], weights: readonly number[]): number[] {
  const blocks: { sumW: number; sumWY: number; count: number }[] = [];
  for (let i = 0; i < targets.length; i += 1) {
    blocks.push({ sumW: at(weights, i), sumWY: at(weights, i) * at(targets, i), count: 1 });
    while (blocks.length >= 2) {
      const last = at(blocks, blocks.length - 1);
      const prev = at(blocks, blocks.length - 2);
      if (prev.sumWY / prev.sumW < last.sumWY / last.sumW) break;
      prev.sumW += last.sumW;
      prev.sumWY += last.sumWY;
      prev.count += last.count;
      blocks.pop();
    }
  }
  const out: number[] = [];
  for (const block of blocks) {
    const mean = block.sumWY / block.sumW;
    for (let k = 0; k < block.count; k += 1) out.push(mean);
  }
  return out;
}

/**
 * Parallel vertical runs inside one channel: orders them so unrelated runs do not cross each other
 * and packs runs with disjoint spans onto the same track. Returns a level per span (-1 = straight).
 */
function assignTracks(spans: readonly TrackSpan[]): { levels: number[]; count: number } {
  const order: number[] = [];
  spans.forEach((span, i) => {
    if (Math.abs(span.y1 - span.y0) >= 0.5) order.push(i);
  });
  const goesDown = (i: number): boolean => at(spans, i).y1 > at(spans, i).y0;
  order.sort((a, b) => {
    const sa = at(spans, a);
    const sb = at(spans, b);
    if (goesDown(a) !== goesDown(b)) return goesDown(a) ? -1 : 1;
    if (goesDown(a)) return sb.y0 - sa.y0 || sb.y1 - sa.y1 || a - b;
    return sa.y0 - sb.y0 || sa.y1 - sb.y1 || a - b;
  });

  const inside = (value: number, span: TrackSpan): boolean =>
    value > Math.min(span.y0, span.y1) + 0.5 && value < Math.max(span.y0, span.y1) - 0.5;
  // Crossings when run `a` sits nearer to the source than run `b`.
  const cost = (a: number, b: number): number =>
    (inside(at(spans, b).y0, at(spans, a)) ? 1 : 0) +
    (inside(at(spans, a).y1, at(spans, b)) ? 1 : 0);
  for (let pass = 0; pass < order.length; pass += 1) {
    let swapped = false;
    for (let k = 0; k + 1 < order.length; k += 1) {
      const a = at(order, k);
      const b = at(order, k + 1);
      if (cost(b, a) < cost(a, b)) {
        order[k] = b;
        order[k + 1] = a;
        swapped = true;
      }
    }
    if (!swapped) break;
  }

  const levels = new Array<number>(spans.length).fill(-1);
  const placed: number[] = [];
  let count = 0;
  for (const i of order) {
    const span = at(spans, i);
    const lo = Math.min(span.y0, span.y1) - 3;
    const hi = Math.max(span.y0, span.y1) + 3;
    let level = 0;
    for (const j of placed) {
      const other = at(spans, j);
      if (lo < Math.max(other.y0, other.y1) && Math.min(other.y0, other.y1) < hi) {
        level = Math.max(level, at(levels, j) + 1);
      }
    }
    levels[i] = level;
    placed.push(i);
    count = Math.max(count, level + 1);
  }
  return { levels, count };
}

function simplify(points: readonly AbsPoint[]): AbsPoint[] {
  const deduped: AbsPoint[] = [];
  for (const point of points) {
    const last = deduped[deduped.length - 1];
    if (last && last.u === point.u && last.v === point.v) continue;
    deduped.push(point);
  }
  const out: AbsPoint[] = [];
  for (const point of deduped) {
    while (out.length >= 2) {
      const a = at(out, out.length - 2);
      const b = at(out, out.length - 1);
      const collinear = (a.u === b.u && b.u === point.u) || (a.v === b.v && b.v === point.v);
      if (!collinear) break;
      out.pop();
    }
    out.push(point);
  }
  return out;
}

const round1 = (value: number): number => Math.round(value * 10) / 10;

/**
 * Sampled arch from (u0,v0) to (u3,v3) leaving and arriving along the flow axis. `lift` bows the
 * middle towards negative v (above the row in `LR`). Used for implied edges.
 */
function archPoints(u0: number, v0: number, u3: number, v3: number, lift: number): AbsPoint[] {
  const forward = u3 > u0 + 24;
  const reach = forward ? Math.min(200, Math.max(36, (u3 - u0) * 0.4)) : 90;
  const samples = 24;
  const sample = (bow: number): AbsPoint[] => {
    const out: AbsPoint[] = [];
    for (let i = 0; i <= samples; i += 1) {
      const t = i / samples;
      const m = 1 - t;
      const u =
        m * m * m * u0 +
        3 * m * m * t * (u0 + reach) +
        3 * m * t * t * (u3 - reach) +
        t * t * t * u3;
      const base = m * m * m * v0 + 3 * m * m * t * v0 + 3 * m * t * t * v3 + t * t * t * v3;
      const s = Math.sin(Math.PI * t);
      out.push({ u: round1(u), v: round1(base - bow * s * s) });
    }
    return out;
  };
  const arch = sample(lift);
  const top = Math.min(...arch.map((p) => p.v));
  // Keep the bow inside the drawing: flatten it when it would leave through the top.
  return top < -8 && lift > 0 ? sample(Math.max(0, lift + top + 8)) : arch;
}

/**
 * Pure layered DAG layout: longest-path layering, weighted barycentric ordering with virtual nodes
 * for long edges, quadratic straightening, orthogonal channel routing. Deterministic: the same
 * input always yields identical coordinates. Dangling dependencies, duplicates and cycles are
 * tolerated (see `prepareDag`).
 */
export function layoutDag(
  steps: readonly Pick<ReflexStep, 'id' | 'dependsOn'>[],
  opts: LayoutOptions = {},
): DagLayout {
  const dag = prepareDag(steps);
  const n = dag.ids.length;
  if (n === 0) return { nodes: [], edges: [], width: 0, height: 0, layers: [] };

  const direction = opts.direction === 'TB' ? 'TB' : 'LR';
  const nodeW = usable(opts.nodeW, DEFAULT_NODE_W, 8);
  const nodeH = usable(opts.nodeH, DEFAULT_NODE_H, 8);
  const gapX = usable(opts.gapX, direction === 'LR' ? DEFAULT_FLOW_GAP : DEFAULT_CROSS_GAP, 0);
  const gapY = usable(opts.gapY, direction === 'LR' ? DEFAULT_CROSS_GAP : DEFAULT_FLOW_GAP, 0);
  const flowExtent = direction === 'LR' ? nodeW : nodeH;
  const crossExtent = direction === 'LR' ? nodeH : nodeW;
  const flowGap = direction === 'LR' ? gapX : gapY;
  const crossGap = direction === 'LR' ? gapY : gapX;

  const depth = dag.layers.length;
  const rawBand = opts.maxLayersPerBand;
  const bandSize =
    typeof rawBand === 'number' && Number.isFinite(rawBand) && rawBand >= 2 && rawBand < depth
      ? Math.floor(rawBand)
      : depth;
  const bandCount = Math.ceil(depth / bandSize);
  const columns = Math.min(bandSize, depth);

  // ---- items: real nodes first, then one virtual node per layer a backbone edge passes through.
  // Edges implied by a longer path are not part of the layout: they only get an arch afterwards. ----
  const implied = findImpliedEdges(dag);
  const impliedPairs: [number, number][] = [];
  const itemLayer: number[] = [...dag.layer];
  const chainOfItem: number[] = new Array<number>(n).fill(-1);
  const up: Nb[][] = Array.from({ length: n }, () => []);
  const down: Nb[][] = Array.from({ length: n }, () => []);
  const chains: Chain[] = [];
  const segments: Segment[] = [];
  for (let from = 0; from < n; from += 1) {
    for (const to of at(dag.succs, from)) {
      if (implied.has(from * n + to)) {
        impliedPairs.push([from, to]);
        continue;
      }
      const span = at(dag.layer, to) - at(dag.layer, from);
      const chain = chains.length;
      const items = [from];
      for (let k = 1; k < span; k += 1) {
        items.push(itemLayer.length);
        itemLayer.push(at(dag.layer, from) + k);
        chainOfItem.push(chain);
        up.push([]);
        down.push([]);
      }
      items.push(to);
      chains.push({ from, to, items });
      for (let k = 0; k + 1 < items.length; k += 1) {
        const a = at(items, k);
        const b = at(items, k + 1);
        const virtualEnds = (a >= n ? 1 : 0) + (b >= n ? 1 : 0);
        const w = EDGE_WEIGHT * (virtualEnds === 2 ? 8 : virtualEnds === 1 ? 2 : 1);
        segments.push({ a, b, w, chain });
        at(down, a).push({ item: b, w });
        at(up, b).push({ item: a, w });
      }
    }
  }
  const itemCount = itemLayer.length;
  const segmentsBelow: Segment[][] = Array.from({ length: depth }, () => []);
  for (const segment of segments) at(segmentsBelow, at(itemLayer, segment.a)).push(segment);

  // ---- ordering within layers: weighted barycentre sweeps + adjacent transposition ----
  const layerItems: number[][] = Array.from({ length: depth }, () => []);
  for (let item = 0; item < itemCount; item += 1) at(layerItems, at(itemLayer, item)).push(item);
  const pos = new Array<number>(itemCount).fill(0);
  const refresh = (layer: number): void => {
    at(layerItems, layer).forEach((item, i) => {
      pos[item] = i;
    });
  };
  for (let layer = 0; layer < depth; layer += 1) refresh(layer);

  const crossingsBelow = (layer: number): number => {
    if (layer < 0 || layer >= depth - 1) return 0;
    const list = at(segmentsBelow, layer);
    let total = 0;
    for (let i = 0; i < list.length; i += 1) {
      const s1 = at(list, i);
      for (let j = i + 1; j < list.length; j += 1) {
        const s2 = at(list, j);
        const da = at(pos, s1.a) - at(pos, s2.a);
        const db = at(pos, s1.b) - at(pos, s2.b);
        if (da * db < 0) total += 1;
      }
    }
    return total;
  };
  const totalCrossings = (): number => {
    let total = 0;
    for (let layer = 0; layer < depth - 1; layer += 1) total += crossingsBelow(layer);
    return total;
  };

  const sweep = (layer: number, neighbours: Nb[][]): void => {
    const items = at(layerItems, layer);
    const keyed = items.map((item, i) => {
      const list = at(neighbours, item);
      if (list.length === 0) return { item, key: i, i };
      let sw = 0;
      let sp = 0;
      for (const nb of list) {
        sw += nb.w;
        sp += nb.w * at(pos, nb.item);
      }
      return { item, key: sp / sw, i };
    });
    keyed.sort((p, q) => p.key - q.key || p.i - q.i);
    layerItems[layer] = keyed.map((entry) => entry.item);
    refresh(layer);
  };

  const transpose = (): void => {
    for (let round = 0; round < 6; round += 1) {
      let improved = false;
      for (let layer = 0; layer < depth; layer += 1) {
        const items = at(layerItems, layer);
        for (let i = 0; i + 1 < items.length; i += 1) {
          const before = crossingsBelow(layer - 1) + crossingsBelow(layer);
          const x = at(items, i);
          const y = at(items, i + 1);
          items[i] = y;
          items[i + 1] = x;
          refresh(layer);
          const after = crossingsBelow(layer - 1) + crossingsBelow(layer);
          if (after < before) {
            improved = true;
          } else {
            items[i] = x;
            items[i + 1] = y;
            refresh(layer);
          }
        }
      }
      if (!improved) break;
    }
  };

  let bestOrder = layerItems.map((list) => [...list]);
  let bestCost = totalCrossings();
  let stale = 0;
  const sweepBudget = itemCount > 1500 ? 4 : MAX_SWEEPS;
  for (let iteration = 0; iteration < sweepBudget && bestCost > 0 && stale < 6; iteration += 1) {
    if (iteration % 2 === 0) for (let layer = 1; layer < depth; layer += 1) sweep(layer, up);
    else for (let layer = depth - 2; layer >= 0; layer -= 1) sweep(layer, down);
    if (itemCount <= 600) transpose();
    const cost = totalCrossings();
    if (cost < bestCost) {
      bestCost = cost;
      bestOrder = layerItems.map((list) => [...list]);
      stale = 0;
    } else {
      stale += 1;
    }
  }
  for (let layer = 0; layer < depth; layer += 1) {
    layerItems[layer] = at(bestOrder, layer);
    refresh(layer);
  }

  // ---- cross-axis coordinates: minimise squared edge offsets under separation constraints ----
  const separation = (a: number, b: number): number => {
    const aVirtual = a >= n;
    const bVirtual = b >= n;
    if (!aVirtual && !bVirtual) return crossExtent + crossGap;
    if (aVirtual && bVirtual) return TRACK_PITCH;
    return crossExtent / 2 + CLEARANCE;
  };
  const center = new Array<number>(itemCount).fill(0);
  const home = new Array<number>(itemCount).fill(0);
  for (const items of layerItems) {
    let total = 0;
    for (let i = 1; i < items.length; i += 1) total += separation(at(items, i - 1), at(items, i));
    let cursor = -total / 2;
    items.forEach((item, i) => {
      if (i > 0) cursor += separation(at(items, i - 1), item);
      center[item] = cursor;
      home[item] = cursor;
    });
  }
  const ANCHOR = 0.04;
  const RUN_WEIGHT = 40;
  for (let round = 0; round < MAX_RELAX_ROUNDS; round += 1) {
    let moved = 0;
    for (let k = 0; k < depth; k += 1) {
      const layer = round % 2 === 0 ? k : depth - 1 - k;
      const items = at(layerItems, layer);
      const prefix: number[] = [0];
      for (let i = 1; i < items.length; i += 1) {
        prefix.push(at(prefix, i - 1) + separation(at(items, i - 1), at(items, i)));
      }
      const targets: number[] = [];
      const weights: number[] = [];
      items.forEach((item, i) => {
        const chain = at(chainOfItem, item);
        if (chain >= 0) {
          // A long edge travels as one flat run: it aims at the middle of its two end nodes.
          const link = at(chains, chain);
          targets.push((at(center, link.from) + at(center, link.to)) / 2 - at(prefix, i));
          weights.push(RUN_WEIGHT);
          return;
        }
        let sw = ANCHOR;
        let sp = ANCHOR * at(home, item);
        for (const nb of at(up, item)) {
          sw += nb.w;
          sp += nb.w * at(center, nb.item);
        }
        for (const nb of at(down, item)) {
          sw += nb.w;
          sp += nb.w * at(center, nb.item);
        }
        targets.push(sp / sw - at(prefix, i));
        weights.push(sw);
      });
      const solved = isotonic(targets, weights);
      items.forEach((item, i) => {
        const next = at(solved, i) + at(prefix, i);
        moved = Math.max(moved, Math.abs(next - at(center, item)));
        center[item] = next;
      });
    }
    if (round > 3 && moved < 0.02) break;
  }
  for (const items of layerItems) {
    items.forEach((item, i) => {
      center[item] = Math.round(at(center, item));
      if (i > 0) {
        const floor = at(center, at(items, i - 1)) + separation(at(items, i - 1), item);
        if (at(center, item) < floor) center[item] = floor;
      }
    });
  }
  // Long edges stay perfectly level where their neighbours allow it (no 1px staircases).
  for (let pass = 0; pass < 2; pass += 1) {
    for (const chain of chains) {
      const run = chain.items.slice(1, -1);
      if (run.length < 2) continue;
      const level = Math.round(run.reduce((sum, item) => sum + at(center, item), 0) / run.length);
      const fits = run.every((item) => {
        const items = at(layerItems, at(itemLayer, item));
        const index = at(pos, item);
        const before = index > 0 ? at(items, index - 1) : undefined;
        const after = index + 1 < items.length ? at(items, index + 1) : undefined;
        if (before !== undefined && level < at(center, before) + separation(before, item)) {
          return false;
        }
        return after === undefined || level <= at(center, after) - separation(item, after);
      });
      if (fits) for (const item of run) center[item] = level;
    }
  }

  // ---- bands (rows of layers); a single band unless a fold was requested ----
  const halfOf = (item: number): number => (item < n ? crossExtent / 2 : 0.5);
  const bandOf = (layer: number): number => Math.floor(layer / bandSize);
  const bandLo = new Array<number>(bandCount).fill(Infinity);
  const bandHi = new Array<number>(bandCount).fill(-Infinity);
  for (let layer = 0; layer < depth; layer += 1) {
    const band = bandOf(layer);
    for (const item of at(layerItems, layer)) {
      bandLo[band] = Math.min(at(bandLo, band), at(center, item) - halfOf(item));
      bandHi[band] = Math.max(at(bandHi, band), at(center, item) + halfOf(item));
    }
  }
  // Band-local cross coordinate of every item.
  const local = new Array<number>(itemCount).fill(0);
  for (let item = 0; item < itemCount; item += 1) {
    local[item] = at(center, item) - at(bandLo, bandOf(at(itemLayer, item)));
  }

  // ---- channel tracks (edges between neighbouring columns of one band) ----
  const channelNeeds = new Array<number>(Math.max(0, columns - 1)).fill(0);
  const trackLevels = new Map<Segment, number>();
  for (let layer = 0; layer + 1 < depth; layer += 1) {
    if (bandOf(layer) !== bandOf(layer + 1)) continue;
    const list = at(segmentsBelow, layer);
    const spans = list.map((segment) => ({
      y0: at(local, segment.a),
      y1: at(local, segment.b),
    }));
    const { levels, count } = assignTracks(spans);
    list.forEach((segment, i) => trackLevels.set(segment, at(levels, i)));
    const column = layer % bandSize;
    channelNeeds[column] = Math.max(at(channelNeeds, column), count);
  }

  const wrapBoundaries: Segment[][] = [];
  for (let band = 0; band + 1 < bandCount; band += 1) {
    wrapBoundaries.push(at(segmentsBelow, (band + 1) * bandSize - 1));
  }
  let maxWrap = 0;
  for (const list of wrapBoundaries) maxWrap = Math.max(maxWrap, list.length);
  const marginEnd = maxWrap > 0 ? WRAP_EXIT_BASE + (maxWrap - 1) * WRAP_PITCH + 6 : 0;
  const marginStart = maxWrap > 0 ? WRAP_ENTRY_BASE + (maxWrap - 1) * WRAP_PITCH + 6 : 0;

  // ---- flow-axis coordinates of the columns ----
  const columnStart = new Array<number>(columns).fill(0);
  columnStart[0] = marginStart;
  for (let c = 1; c < columns; c += 1) {
    const need = at(channelNeeds, c - 1);
    const width = Math.max(
      flowGap,
      need > 0 ? ELBOW_SRC + ELBOW_DST + (need - 1) * ELBOW_PITCH : 0,
    );
    columnStart[c] = at(columnStart, c - 1) + flowExtent + width;
  }
  const columnEnd = (c: number): number => at(columnStart, c) + flowExtent;
  const flowSize = columnEnd(columns - 1) + marginEnd;

  // ---- band offsets along the cross axis (gutters hold the wrapped edges) ----
  const bandOffset = new Array<number>(bandCount).fill(0);
  const gutterTop = new Array<number>(Math.max(0, bandCount - 1)).fill(0);
  for (let band = 0; band + 1 < bandCount; band += 1) {
    const size = Math.ceil(at(bandHi, band) - at(bandLo, band));
    const wraps = at(wrapBoundaries, band).length;
    const gutter = Math.max(BAND_GAP_MIN, 2 * WRAP_CLEARANCE + Math.max(0, wraps - 1) * WRAP_PITCH);
    gutterTop[band] = at(bandOffset, band) + size;
    bandOffset[band + 1] = at(bandOffset, band) + size + gutter;
  }
  const absV = (item: number): number =>
    at(bandOffset, bandOf(at(itemLayer, item))) + at(local, item);
  const columnOf = (item: number): number => at(itemLayer, item) % bandSize;

  // ---- routes ----
  const unitPoints = (segment: Segment): AbsPoint[] => {
    const layerA = at(itemLayer, segment.a);
    const layerB = at(itemLayer, segment.b);
    const v0 = absV(segment.a);
    const v1 = absV(segment.b);
    if (bandOf(layerA) === bandOf(layerB)) {
      const uStart = columnEnd(columnOf(segment.a));
      const uEnd = at(columnStart, columnOf(segment.b));
      const level = trackLevels.get(segment) ?? -1;
      if (level < 0) {
        return [
          { u: uStart, v: v0 },
          { u: uEnd, v: v0 },
        ];
      }
      const turn = uStart + ELBOW_SRC + level * ELBOW_PITCH;
      return [
        { u: uStart, v: v0 },
        { u: turn, v: v0 },
        { u: turn, v: v1 },
        { u: uEnd, v: v1 },
      ];
    }
    const boundary = bandOf(layerA);
    const list = at(wrapBoundaries, boundary);
    const bySource = [...list].sort(
      (p, q) => absV(p.a) - absV(q.a) || absV(p.b) - absV(q.b) || p.chain - q.chain,
    );
    const byTarget = [...list].sort(
      (p, q) => absV(p.b) - absV(q.b) || absV(p.a) - absV(q.a) || p.chain - q.chain,
    );
    const count = list.length;
    const sourceRank = bySource.indexOf(segment);
    const targetRank = byTarget.indexOf(segment);
    const exitTurn =
      columnEnd(columns - 1) + WRAP_EXIT_BASE + (count - 1 - sourceRank) * WRAP_PITCH;
    const entryTurn = at(columnStart, 0) - WRAP_ENTRY_BASE - targetRank * WRAP_PITCH;
    const trackV = at(gutterTop, boundary) + WRAP_CLEARANCE + (count - 1 - sourceRank) * WRAP_PITCH;
    return [
      { u: columnEnd(columns - 1), v: v0 },
      { u: exitTurn, v: v0 },
      { u: exitTurn, v: trackV },
      { u: entryTurn, v: trackV },
      { u: entryTurn, v: v1 },
      { u: at(columnStart, 0), v: v1 },
    ];
  };
  const unitByChain: Segment[][] = chains.map(() => []);
  for (const segment of segments) at(unitByChain, segment.chain).push(segment);

  const toPoint = (p: AbsPoint): { x: number; y: number } =>
    direction === 'LR' ? { x: p.u, y: p.v } : { x: p.v, y: p.u };

  const edges: LayoutEdge[] = chains.map((chain, index) => {
    const raw: AbsPoint[] = [];
    for (const segment of at(unitByChain, index)) raw.push(...unitPoints(segment));
    return {
      from: at(dag.ids, chain.from),
      to: at(dag.ids, chain.to),
      points: simplify(raw).map(toPoint),
    };
  });

  // Position of every real node among the real nodes of its layer.
  const realIndex = new Array<number>(n).fill(0);
  const layers: string[][] = [];
  for (const items of layerItems) {
    const ids: string[] = [];
    for (const item of items) {
      if (item >= n) continue;
      realIndex[item] = ids.length;
      ids.push(at(dag.ids, item));
    }
    layers.push(ids);
  }

  const nodes: LayoutNode[] = [];
  for (let node = 0; node < n; node += 1) {
    const u = at(columnStart, columnOf(node));
    const crossStart = absV(node) - crossExtent / 2;
    nodes.push({
      id: at(dag.ids, node),
      layer: at(dag.layer, node),
      index: at(realIndex, node),
      x: direction === 'LR' ? u : crossStart,
      y: direction === 'LR' ? crossStart : u,
      w: nodeW,
      h: nodeH,
    });
  }

  let crossSize = 0;
  for (let band = 0; band < bandCount; band += 1) {
    crossSize = Math.max(
      crossSize,
      at(bandOffset, band) + Math.ceil(at(bandHi, band) - at(bandLo, band)),
    );
  }
  let width = direction === 'LR' ? flowSize : crossSize;
  let height = direction === 'LR' ? crossSize : flowSize;
  for (const edge of edges) {
    for (const point of edge.points) {
      width = Math.max(width, point.x);
      height = Math.max(height, point.y);
    }
  }
  width = Math.ceil(width);
  height = Math.ceil(height);

  // Implied edges: quiet arches from the source anchor to the target anchor, drawn behind nodes.
  const limit = 10;
  for (const [from, to] of impliedPairs) {
    const sameBand = bandOf(at(dag.layer, from)) === bandOf(at(dag.layer, to));
    const u0 = columnEnd(columnOf(from));
    const u3 = at(columnStart, columnOf(to));
    const points = archPoints(
      u0,
      absV(from),
      u3,
      absV(to),
      sameBand ? Math.min(44, Math.max(12, (u3 - u0) * 0.07)) : 0,
    ).map(toPoint);
    edges.push({
      from: at(dag.ids, from),
      to: at(dag.ids, to),
      implied: true,
      points: points.map((p) => ({
        x: Math.min(width + limit, Math.max(-limit, p.x)),
        y: Math.min(height + limit, Math.max(-limit, p.y)),
      })),
    });
  }
  return { nodes, edges, width, height, layers };
}
