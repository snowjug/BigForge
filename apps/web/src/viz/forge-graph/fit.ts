import type { ReflexStep } from '@bigforge/schemas';
import { layoutDag, type DagLayout, type LayoutOptions } from './layout';

/** Fewer columns per row than this is no longer worth folding: the graph scrolls instead. */
export const MIN_FOLD_COLUMNS = 3;

/**
 * Lays a left-to-right graph out at its natural size and, when that is wider than the container,
 * folds the layers into the fewest rows that fit (balanced, like wrapped text). If even the
 * narrowest fold does not fit, the natural layout is returned and the wrapper scrolls.
 * Top-to-bottom graphs are never folded.
 */
export function fitLayout(
  steps: readonly Pick<ReflexStep, 'id' | 'dependsOn'>[],
  opts: LayoutOptions,
  available: number | null,
  padding: number,
): DagLayout {
  const natural = layoutDag(steps, opts);
  if (opts.direction === 'TB' || available === null || available <= 0) return natural;
  if (natural.width + padding * 2 <= available) return natural;

  const depth = natural.layers.length;
  const nodeW = opts.nodeW ?? natural.nodes[0]?.w ?? 160;
  const gap = opts.gapX ?? 40;
  const capacity = Math.floor((available - padding * 2 + gap) / (nodeW + gap));
  const tried = new Set<number>();
  for (let columns = Math.min(depth - 1, capacity); columns >= MIN_FOLD_COLUMNS; columns -= 1) {
    const rows = Math.ceil(depth / columns);
    const balanced = Math.ceil(depth / rows);
    if (tried.has(balanced)) continue;
    tried.add(balanced);
    const folded = layoutDag(steps, { ...opts, maxLayersPerBand: balanced });
    if (folded.width + padding * 2 <= available) return folded;
  }
  return natural;
}
