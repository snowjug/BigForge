import type { TraceEvent } from '@bigforge/schemas';

/**
 * Token Flow: a Sankey of where a baseline run's tokens went and what BigForge still had to send.
 * Pure layout. Token counts come from the deterministic provider, so every figure here is synthetic.
 */

export interface PurposeRow {
  key: string;
  label: string;
  calls: number;
  uncachedInput: number;
  cachedInput: number;
  output: number;
  total: number;
}

export const UNLABELLED = 'unlabelled';

/** "inspect_dependency_exports" -> "inspect dependency exports". */
export function purposeLabel(key: string): string {
  return key.replace(/_/g, ' ');
}

/** Groups model calls by their harness-provided purpose, in order of first appearance. */
export function aggregatePurposes(events: readonly TraceEvent[]): PurposeRow[] {
  const rows = new Map<string, PurposeRow>();
  for (const event of events) {
    if (event.kind !== 'model_call') continue;
    const key = event.purpose ?? UNLABELLED;
    const row = rows.get(key) ?? {
      key,
      label: purposeLabel(key),
      calls: 0,
      uncachedInput: 0,
      cachedInput: 0,
      output: 0,
      total: 0,
    };
    const cached = Math.min(event.usage.cachedInputTokens, event.usage.inputTokens);
    row.calls += 1;
    row.cachedInput += cached;
    row.uncachedInput += event.usage.inputTokens - cached;
    row.output += event.usage.outputTokens;
    row.total += event.usage.inputTokens + event.usage.outputTokens;
    rows.set(key, row);
  }
  return [...rows.values()];
}

export interface Allocation {
  /** Tokens of the Reflex run kept per purpose. */
  perPurpose: Map<string, number>;
  /** How the split was decided. */
  basis: 'replaced_steps' | 'proportional' | 'none';
  /** Reflex tokens beyond everything the baseline spent (never negative). */
  overspend: number;
}

/**
 * Places the tokens the Reflex still sent onto the baseline purposes they stand in for: the purposes the
 * boundary step replaced (from its rationale), in proportion to their baseline tokens. The split is an
 * estimate: the Reflex made one call, not one per purpose. Falls back to all purposes when no step says.
 */
export function allocateRemaining(
  purposes: readonly PurposeRow[],
  reflexTokens: number,
  replacedKeys: ReadonlySet<string> | null,
): Allocation {
  const perPurpose = new Map<string, number>();
  const baselineTotal = purposes.reduce((sum, row) => sum + row.total, 0);
  if (reflexTokens <= 0 || baselineTotal <= 0) {
    return { perPurpose, basis: 'none', overspend: Math.max(0, reflexTokens - baselineTotal) };
  }
  const targeted = replacedKeys ? purposes.filter((row) => replacedKeys.has(row.key)) : [];
  const pool = targeted.length > 0 ? targeted : [...purposes];
  const basis: Allocation['basis'] = targeted.length > 0 ? 'replaced_steps' : 'proportional';
  const kept = Math.min(reflexTokens, baselineTotal);
  const poolTotal = pool.reduce((sum, row) => sum + row.total, 0);
  let remaining = kept;
  // Proportional shares, capped at what the purpose spent; any spill goes to the others in order.
  for (const row of pool) {
    const share = Math.min(row.total, (kept * row.total) / poolTotal);
    perPurpose.set(row.key, share);
    remaining -= share;
  }
  for (const row of purposes) {
    if (remaining <= 1e-9) break;
    const have = perPurpose.get(row.key) ?? 0;
    const room = row.total - have;
    if (room <= 0) continue;
    const add = Math.min(room, remaining);
    perPurpose.set(row.key, have + add);
    remaining -= add;
  }
  return { perPurpose, basis, overspend: Math.max(0, reflexTokens - baselineTotal) };
}

export type FlowPattern = 'solid' | 'dots' | 'stripes';
export type FlowTone = 'ember' | 'ash' | 'steel' | 'molten';

export interface FlowNode {
  id: string;
  column: 0 | 1 | 2;
  label: string;
  /** Second line: tokens, share, calls. */
  detail: string;
  value: number;
  tone: FlowTone;
  pattern: FlowPattern;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface FlowLink {
  id: string;
  from: string;
  to: string;
  value: number;
  tone: FlowTone;
  pattern: FlowPattern;
  /** Centre line: starts at (x0, y0) on the source's right edge and ends at (x1, y1) on the target's left edge. */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  thickness: number;
  /** The value is an estimated allocation, not a recorded figure. */
  estimated: boolean;
}

export interface FlowInput {
  baseline: readonly PurposeRow[];
  /** Tokens the Reflex run spent (the boundary call). `null` draws the baseline side only. */
  reflex: { total: number; input: number; output: number } | null;
  /** Purposes replaced by the boundary step; `null` when unknown. */
  replacedKeys: ReadonlySet<string> | null;
}

export interface FlowLayout {
  width: number;
  height: number;
  nodes: FlowNode[];
  links: FlowLink[];
  baselineTotal: number;
  sent: number;
  avoided: number;
  overspend: number;
  basis: Allocation['basis'];
  empty: boolean;
}

export interface FlowSize {
  width: number;
  height: number;
}

const NODE_W = 12;
/** Space between stacked nodes. The purposes column is looser: its labels sit on one line each. */
const PAD_TYPES = 10;
const PAD_PURPOSES = 15;
const PAD_OUTCOME = 12;
const MIN_NODE_H = 4;
const MIN_LINK = 1.5;
const TOP = 8;
const BOTTOM = 8;

interface Gutters {
  left: number;
  right: number;
}

function gutters(width: number, withOutcome: boolean): Gutters {
  // The purposes' labels sit to the right of their bars: with no outcome column they need the room.
  return { left: width < 560 ? 96 : 140, right: withOutcome ? (width < 560 ? 112 : 156) : 260 };
}

/** Heights for `values` at scale `k`, with a floor so thin flows stay visible. */
const heightOf = (value: number, k: number): number =>
  value > 0 ? Math.max(MIN_NODE_H, value * k) : 0;

/** Largest scale at which the busiest column still fits in `innerHeight`. */
function fitScale(
  columns: readonly { values: readonly number[]; pad: number }[],
  innerHeight: number,
): number {
  let low = 0;
  let high = 1;
  const fits = (k: number) =>
    columns.every(
      ({ values, pad }) =>
        values.reduce((sum, value) => sum + heightOf(value, k), 0) +
          Math.max(0, values.filter((value) => value > 0).length - 1) * pad <=
        innerHeight,
    );
  while (fits(high) && high < 1e6) high *= 2;
  for (let index = 0; index < 40; index += 1) {
    const mid = (low + high) / 2;
    if (fits(mid)) low = mid;
    else high = mid;
  }
  return low;
}

export function layoutTokenFlow(input: FlowInput, size: FlowSize): FlowLayout {
  const purposes = input.baseline.filter((row) => row.total > 0);
  const baselineTotal = purposes.reduce((sum, row) => sum + row.total, 0);
  const empty = baselineTotal <= 0;
  const withOutcome = input.reflex !== null;
  const reflexTotal = input.reflex?.total ?? 0;
  const allocation = allocateRemaining(purposes, reflexTotal, input.replacedKeys);
  const sent = Math.min(reflexTotal, baselineTotal);
  const avoided = Math.max(0, baselineTotal - reflexTotal);
  const base: FlowLayout = {
    width: size.width,
    height: size.height,
    nodes: [],
    links: [],
    baselineTotal,
    sent: input.reflex ? reflexTotal : 0,
    avoided: withOutcome ? avoided : 0,
    overspend: allocation.overspend,
    basis: allocation.basis,
    empty,
  };
  if (empty) return base;

  const totals = {
    uncached: purposes.reduce((sum, row) => sum + row.uncachedInput, 0),
    cached: purposes.reduce((sum, row) => sum + row.cachedInput, 0),
    output: purposes.reduce((sum, row) => sum + row.output, 0),
  };
  const typeCandidates: { id: string; label: string; value: number; pattern: FlowPattern }[] = [
    { id: 'type:uncached', label: 'Uncached input', value: totals.uncached, pattern: 'solid' },
    { id: 'type:cached', label: 'Cached input', value: totals.cached, pattern: 'dots' },
    { id: 'type:output', label: 'Output', value: totals.output, pattern: 'stripes' },
  ];
  const typeNodes = typeCandidates.filter((node) => node.value > 0);

  const outcomeValues: { id: string; label: string; value: number; tone: FlowTone }[] = [];
  if (withOutcome) {
    if (sent > 0)
      outcomeValues.push({ id: 'out:sent', label: 'Still sent', value: sent, tone: 'molten' });
    if (avoided > 0)
      outcomeValues.push({ id: 'out:avoided', label: 'Avoided', value: avoided, tone: 'steel' });
  }

  const g = gutters(size.width, withOutcome);
  const innerWidth = Math.max(240, size.width - g.left - g.right);
  const columnsCount = withOutcome ? 3 : 2;
  const free = innerWidth - NODE_W * columnsCount;
  const gap01 = withOutcome ? Math.max(48, free * 0.3) : Math.max(120, free);
  const x0 = g.left;
  const x1 = x0 + NODE_W + gap01;
  const x2 = size.width - g.right - NODE_W;

  const innerHeight = Math.max(120, size.height - TOP - BOTTOM);
  const k = fitScale(
    [
      { values: typeNodes.map((node) => node.value), pad: PAD_TYPES },
      { values: purposes.map((row) => row.total), pad: PAD_PURPOSES },
      ...(withOutcome
        ? [{ values: outcomeValues.map((node) => node.value), pad: PAD_OUTCOME }]
        : []),
    ],
    innerHeight,
  );

  const place = <T extends { value: number }>(items: readonly T[], pad: number) => {
    const heights = items.map((item) => heightOf(item.value, k));
    const used = heights.reduce((sum, h) => sum + h, 0) + Math.max(0, items.length - 1) * pad;
    let y = TOP + Math.max(0, (innerHeight - used) / 2);
    return items.map((item, index) => {
      const h = heights[index] ?? 0;
      const placed = { item, y, h };
      y += h + pad;
      return placed;
    });
  };

  const nodes: FlowNode[] = [];
  const nodeById = new Map<string, FlowNode>();
  const push = (node: FlowNode) => {
    nodes.push(node);
    nodeById.set(node.id, node);
  };
  const share = (value: number) =>
    `${((value / baselineTotal) * 100).toFixed(value / baselineTotal < 0.1 ? 1 : 0)}%`;

  for (const { item, y, h } of place(typeNodes, PAD_TYPES)) {
    push({
      id: item.id,
      column: 0,
      label: item.label,
      detail: `${Math.round(item.value).toLocaleString('en-US')} tokens`,
      value: item.value,
      tone: 'ember',
      pattern: item.pattern,
      x: x0,
      y,
      w: NODE_W,
      h,
    });
  }
  for (const { item, y, h } of place(
    purposes.map((row) => ({ row, value: row.total })),
    PAD_PURPOSES,
  )) {
    const { row } = item;
    push({
      id: `purpose:${row.key}`,
      column: 1,
      label: row.calls > 1 ? `${row.label} \u00d7${row.calls}` : row.label,
      detail: `${Math.round(row.total).toLocaleString('en-US')} tokens \u00b7 ${share(row.total)}`,
      value: row.total,
      tone: 'ash',
      pattern: 'solid',
      x: x1,
      y,
      w: NODE_W,
      h,
    });
  }
  if (withOutcome) {
    for (const { item, y, h } of place(outcomeValues, PAD_OUTCOME)) {
      push({
        id: item.id,
        column: 2,
        label: item.label,
        detail: `${Math.round(item.value).toLocaleString('en-US')} tokens \u00b7 ${share(item.value)}`,
        value: item.value,
        tone: item.tone,
        pattern: 'solid',
        x: x2,
        y,
        w: NODE_W,
        h,
      });
    }
  }

  // ---- links ----
  interface RawLink {
    id: string;
    from: string;
    to: string;
    value: number;
    tone: FlowTone;
    pattern: FlowPattern;
    estimated: boolean;
  }
  const raw: RawLink[] = [];
  for (const row of purposes) {
    const to = `purpose:${row.key}`;
    const parts: [string, number, FlowPattern][] = [
      ['type:uncached', row.uncachedInput, 'solid'],
      ['type:cached', row.cachedInput, 'dots'],
      ['type:output', row.output, 'stripes'],
    ];
    for (const [from, value, pattern] of parts) {
      if (value > 0)
        raw.push({
          id: `${from}>${to}`,
          from,
          to,
          value,
          tone: 'ember',
          pattern,
          estimated: false,
        });
    }
    if (withOutcome) {
      const kept = allocation.perPurpose.get(row.key) ?? 0;
      const gone = row.total - kept;
      if (gone > 1e-9) {
        raw.push({
          id: `${to}>out:avoided`,
          from: to,
          to: 'out:avoided',
          value: gone,
          tone: 'steel',
          pattern: 'solid',
          estimated: reflexTotal > 0,
        });
      }
      if (kept > 1e-9) {
        raw.push({
          id: `${to}>out:sent`,
          from: to,
          to: 'out:sent',
          value: kept,
          tone: 'molten',
          pattern: 'solid',
          estimated: true,
        });
      }
    }
  }

  const thicknessOf = (value: number) => Math.max(MIN_LINK, value * k);
  const outgoing = new Map<string, RawLink[]>();
  const incoming = new Map<string, RawLink[]>();
  const append = (map: Map<string, RawLink[]>, key: string, link: RawLink) => {
    const list = map.get(key);
    if (list) list.push(link);
    else map.set(key, [link]);
  };
  for (const link of raw) {
    append(outgoing, link.from, link);
    append(incoming, link.to, link);
  }
  const centerY = (id: string) => {
    const node = nodeById.get(id);
    return node ? node.y + node.h / 2 : 0;
  };
  const sourceOffset = new Map<string, number>();
  const targetOffset = new Map<string, number>();
  for (const [id, links] of outgoing) {
    const node = nodeById.get(id);
    if (!node) continue;
    let y = node.y;
    for (const link of [...links].sort((a, b) => centerY(a.to) - centerY(b.to))) {
      const t = thicknessOf(link.value);
      sourceOffset.set(link.id, y + t / 2);
      y += t;
    }
  }
  for (const [id, links] of incoming) {
    const node = nodeById.get(id);
    if (!node) continue;
    let y = node.y;
    for (const link of [...links].sort((a, b) => centerY(a.from) - centerY(b.from))) {
      const t = thicknessOf(link.value);
      targetOffset.set(link.id, y + t / 2);
      y += t;
    }
  }
  const links: FlowLink[] = raw.map((link) => {
    const from = nodeById.get(link.from);
    const to = nodeById.get(link.to);
    return {
      id: link.id,
      from: link.from,
      to: link.to,
      value: link.value,
      tone: link.tone,
      pattern: link.pattern,
      x0: (from?.x ?? 0) + NODE_W,
      y0: sourceOffset.get(link.id) ?? 0,
      x1: to?.x ?? 0,
      y1: targetOffset.get(link.id) ?? 0,
      thickness: thicknessOf(link.value),
      estimated: link.estimated,
    };
  });

  return { ...base, nodes, links };
}

/** The SVG path of a link's centre line: a horizontal S-curve. */
export function linkPath(link: Pick<FlowLink, 'x0' | 'y0' | 'x1' | 'y1'>): string {
  const mid = (link.x0 + link.x1) / 2;
  return `M${link.x0} ${link.y0}C${mid} ${link.y0} ${mid} ${link.y1} ${link.x1} ${link.y1}`;
}

/** Rows of the equivalent table: one per baseline purpose with what the Reflex kept of it. */
export interface FlowTableRow extends PurposeRow {
  kept: number;
  avoided: number;
}

export function flowTable(
  purposes: readonly PurposeRow[],
  reflexTokens: number | null,
  replacedKeys: ReadonlySet<string> | null,
): FlowTableRow[] {
  const allocation =
    reflexTokens === null ? null : allocateRemaining(purposes, reflexTokens, replacedKeys);
  return purposes.map((row) => {
    const kept = allocation?.perPurpose.get(row.key) ?? 0;
    return { ...row, kept, avoided: allocation ? Math.max(0, row.total - kept) : 0 };
  });
}
