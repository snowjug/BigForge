import type { BoundaryResolution, FirewallDecision } from '@bigforge/schemas';

/**
 * Uncertainty Lens layout: every evidence chunk the run had observed as a faded bubble (area proportional
 * to tokens), and the few the Token Firewall let through as bright bubbles inside a circular lens.
 * Pure and deterministic: the same decision always gives the same picture.
 */

export interface Circle {
  cx: number;
  cy: number;
  r: number;
}

export type ScreeningFinding = 'clean' | 'redacted' | 'instruction_like';

export interface LensChunk {
  id: string;
  source: string;
  /** Short name for a bubble: "token.ts", "signToken", "ci-log". */
  name: string;
  /** 1-based number of a selected chunk (the order the call record lists them), null when rejected. */
  n: number | null;
  tokens: number;
  tags: string[];
  state: 'selected' | 'rejected';
  /** Why it was selected (the call record's reason) or withheld (the firewall's reason). */
  reason: string;
  screening: ScreeningFinding | null;
  screeningDetail: string | null;
  /** Position in the faded blob of everything observed. */
  blob: Circle;
  /** Position inside the lens, magnified. Selected chunks only. */
  lens: Circle | null;
}

export interface LensLayout {
  width: number;
  height: number;
  blobBox: { x: number; y: number; w: number; h: number };
  lens: Circle;
  /** How much larger a selected chunk is drawn inside the lens than in the blob. */
  magnification: number;
  chunks: LensChunk[];
  observedTokens: number;
  selectedTokens: number;
  withheldTokens: number;
}

/** A compact label for an evidence source: the file name, the symbol or the kind of evidence. */
export function chunkName(source: string): string {
  const colon = source.indexOf(':');
  const kind = colon >= 0 ? source.slice(0, colon) : source;
  const rest = colon >= 0 ? source.slice(colon + 1) : '';
  if (kind === 'file') return rest.split('/').pop() ?? rest;
  if (kind === 'export') return rest;
  return kind;
}

const GAP = 2;
const MIN_BLOB_R = 4.5;
const MIN_LENS_R = 8;

type Inside = (cx: number, cy: number, r: number) => boolean;

/**
 * Places circles of the given radii (largest first) on a spiral from `center`, each at the first spot that
 * neither overlaps a placed circle nor leaves `inside`. Returns `null` when one does not fit.
 */
function packCircles(
  radii: readonly number[],
  center: { x: number; y: number },
  inside: Inside,
): Circle[] | null {
  const placed: Circle[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (const r of radii) {
    let found: Circle | null = null;
    for (let index = 0; index < 4000 && !found; index += 1) {
      const radius = index === 0 ? 0 : Math.sqrt(index) * 2.2;
      const angle = index * golden;
      const cx = center.x + radius * Math.cos(angle);
      const cy = center.y + radius * Math.sin(angle);
      if (!inside(cx, cy, r)) continue;
      if (placed.every((other) => Math.hypot(other.cx - cx, other.cy - cy) >= other.r + r + GAP)) {
        found = { cx, cy, r };
      }
    }
    if (!found) return null;
    placed.push(found);
  }
  return placed;
}

/** Packs as large as fits: shrinks the scale until every circle finds a place. */
function packScaled(
  tokens: readonly number[],
  startScale: number,
  minR: number,
  center: { x: number; y: number },
  inside: Inside,
): { circles: Circle[]; scale: number } {
  let scale = startScale;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const radii = tokens.map((value) => Math.max(minR, scale * Math.sqrt(value)));
    const circles = packCircles(radii, center, inside);
    if (circles) return { circles, scale };
    scale *= 0.92;
  }
  const radii = tokens.map(() => minR);
  return { circles: packCircles(radii, center, inside) ?? [], scale: 0 };
}

function reasonFor(
  decision: FirewallDecision,
  record: BoundaryResolution['record'],
  id: string,
): string {
  const selected = record.minimumContext.find((entry) => entry.chunkId === id);
  if (selected) return selected.reason;
  const rejected = decision.rejected.find((entry) => entry.chunkId === id);
  return rejected ? rejected.reason : 'withheld by the firewall';
}

export interface LensSize {
  width: number;
  height: number;
}

export function layoutLens(
  boundary: Pick<BoundaryResolution, 'decision' | 'record'>,
  size: LensSize,
): LensLayout {
  const { decision, record } = boundary;
  const { width, height } = size;
  const selectedIds = new Set(decision.selected.map((chunk) => chunk.id));
  const considered = decision.considered.length > 0 ? decision.considered : decision.selected;
  const screening = new Map(decision.screening.map((entry) => [entry.chunkId, entry]));

  const blobBox = { x: 4, y: 4, w: Math.max(120, width * 0.43), h: height - 8 };
  // The lens leaves room under it for its caption.
  const lensR = Math.max(48, Math.min(width * 0.16, (height - 52) / 2));
  const lens: Circle = { cx: width * 0.81, cy: 8 + lensR, r: lensR };

  // ---- the blob of everything observed ----
  const order = [...considered].sort((a, b) => b.tokens - a.tokens || a.id.localeCompare(b.id));
  const observedTokens = order.reduce((sum, chunk) => sum + chunk.tokens, 0);
  const blobCenter = { x: blobBox.x + blobBox.w / 2, y: blobBox.y + blobBox.h / 2 };
  const blobInside: Inside = (cx, cy, r) =>
    cx - r >= blobBox.x &&
    cx + r <= blobBox.x + blobBox.w &&
    cy - r >= blobBox.y &&
    cy + r <= blobBox.y + blobBox.h;
  const fill = 0.5;
  const startScale =
    observedTokens > 0
      ? Math.min(
          Math.sqrt((fill * blobBox.w * blobBox.h) / (Math.PI * observedTokens)),
          (0.46 * Math.min(blobBox.w, blobBox.h)) /
            Math.sqrt(Math.max(...order.map((chunk) => chunk.tokens), 1)),
        )
      : MIN_BLOB_R;
  const blobPack = packScaled(
    order.map((chunk) => chunk.tokens),
    startScale,
    MIN_BLOB_R,
    blobCenter,
    blobInside,
  );
  const blobById = new Map(
    order.map((chunk, index) => [chunk.id, blobPack.circles[index]] as const),
  );

  // ---- the lens: the selected chunks, magnified ----
  const selectedOrder = order.filter((chunk) => selectedIds.has(chunk.id));
  const selectedTokens = selectedOrder.reduce((sum, chunk) => sum + chunk.tokens, 0);
  const lensInside: Inside = (cx, cy, r) =>
    Math.hypot(cx - lens.cx, cy - lens.cy) + r <= lens.r * 0.86;
  const lensStart =
    selectedTokens > 0
      ? Math.max(blobPack.scale, Math.sqrt((0.3 * lens.r * lens.r) / selectedTokens))
      : MIN_LENS_R;
  const lensPack = packScaled(
    selectedOrder.map((chunk) => chunk.tokens),
    lensStart,
    MIN_LENS_R,
    { x: lens.cx, y: lens.cy },
    lensInside,
  );
  const lensById = new Map(
    selectedOrder.map((chunk, index) => [chunk.id, lensPack.circles[index]] as const),
  );
  const magnification = blobPack.scale > 0 ? lensPack.scale / blobPack.scale : 1;

  const numbers = new Map(decision.selected.map((chunk, index) => [chunk.id, index + 1] as const));
  const chunks: LensChunk[] = considered.map((chunk) => {
    const found = screening.get(chunk.id);
    const selected = selectedIds.has(chunk.id);
    return {
      id: chunk.id,
      source: chunk.source,
      name: chunkName(chunk.source),
      n: numbers.get(chunk.id) ?? null,
      tokens: chunk.tokens,
      tags: chunk.tags,
      state: selected ? 'selected' : 'rejected',
      reason: reasonFor(decision, record, chunk.id),
      screening: found ? found.finding : null,
      screeningDetail: found ? found.detail : null,
      blob: blobById.get(chunk.id) ?? { cx: blobCenter.x, cy: blobCenter.y, r: MIN_BLOB_R },
      lens: selected ? (lensById.get(chunk.id) ?? null) : null,
    };
  });

  return {
    width,
    height,
    blobBox,
    lens,
    magnification: Math.max(1, magnification),
    chunks,
    observedTokens: decision.tokensConsidered || observedTokens,
    selectedTokens: decision.tokensSelected || selectedTokens,
    withheldTokens: Math.max(
      0,
      (decision.tokensConsidered || observedTokens) - (decision.tokensSelected || selectedTokens),
    ),
  };
}

/** The verdicts the firewall passed through, always ending with the final one. */
export function verdictPath(decision: Pick<FirewallDecision, 'path' | 'verdict'>): string[] {
  const path = decision.path.length > 0 ? [...decision.path] : [];
  if (path[path.length - 1] !== decision.verdict) path.push(decision.verdict);
  return path;
}

export type OutcomeTone = 'jade' | 'crimson' | 'molten' | 'amber';

export interface OutcomeInfo {
  label: string;
  tone: OutcomeTone;
  detail: string;
}

export function outcomeInfo(outcome: BoundaryResolution['outcome']): OutcomeInfo {
  switch (outcome) {
    case 'resolved':
      return {
        label: 'Resolved',
        tone: 'jade',
        detail: 'The answer passed validation and the Reflex continued.',
      };
    case 'denied':
      return {
        label: 'Denied',
        tone: 'crimson',
        detail: 'The firewall refused the call. No model was called.',
      };
    case 'invalid_output':
      return {
        label: 'Invalid output',
        tone: 'amber',
        detail: 'The model answered, but the answer failed validation and was not used.',
      };
    case 'provider_error':
      return {
        label: 'Provider error',
        tone: 'crimson',
        detail: 'The provider failed. Nothing was guessed.',
      };
    case 'needs_human':
      return {
        label: 'Needs a human',
        tone: 'molten',
        detail: 'The Reflex handed this decision to a person.',
      };
  }
}

/** Share of observed evidence tokens the firewall kept out of the call (0..1). */
export function withheldRatio(
  layout: Pick<LensLayout, 'observedTokens' | 'withheldTokens'>,
): number {
  return layout.observedTokens > 0 ? layout.withheldTokens / layout.observedTokens : 0;
}
