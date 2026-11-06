import { niceCeil, type LinearScale } from './scale';

/** One ledger line of the investment (`EconomicsReport.investment.lines`), reduced to what the waterfall needs. */
export interface WaterfallInput {
  id: string;
  label: string;
  /** Tokens or dollars, whichever view is drawn. */
  value: number;
  /** Counts toward the investment (the conservative toggle includes the learning phase). */
  counted: boolean;
  provenance: string;
  note: string;
  runs: number;
}

export type WaterfallBarKind = 'step' | 'total' | 'excluded';

export interface WaterfallBar extends WaterfallInput {
  kind: WaterfallBarKind;
  /** Left edge in data units. A step starts where the running total ended. */
  start: number;
  end: number;
  /** value / total, 0 when the total is 0. */
  share: number;
}

export interface WaterfallLayout {
  bars: WaterfallBar[];
  total: number;
  /** A round upper bound for the value axis. */
  domainMax: number;
}

/**
 * Lays out a ledger as a waterfall: counted lines accumulate left to right into the total; a line that
 * is not counted hangs after the total as a ghost ("would add") so it is visible but never summed.
 */
export function layoutWaterfall(
  lines: readonly WaterfallInput[],
  options: { totalLabel: string; totalValue?: number },
): WaterfallLayout {
  const counted = lines.filter((line) => line.counted);
  const excluded = lines.filter((line) => !line.counted);
  const computed = counted.reduce((sum, line) => sum + line.value, 0);
  const total = options.totalValue ?? computed;
  const share = (value: number): number => (total > 0 ? value / total : 0);

  const bars: WaterfallBar[] = [];
  let running = 0;
  for (const line of counted) {
    bars.push({
      ...line,
      kind: 'step',
      start: running,
      end: running + line.value,
      share: share(line.value),
    });
    running += line.value;
  }
  bars.push({
    id: 'total',
    label: options.totalLabel,
    value: total,
    counted: true,
    provenance: summaryProvenance(counted),
    note: '',
    runs: 0,
    kind: 'total',
    start: 0,
    end: total,
    share: total > 0 ? 1 : 0,
  });
  for (const line of excluded) {
    bars.push({
      ...line,
      kind: 'excluded',
      start: total,
      end: total + line.value,
      share: share(line.value),
    });
  }
  const furthest = bars.reduce((max, bar) => Math.max(max, bar.end), 0);
  return { bars, total, domainMax: furthest > 0 ? niceCeil(furthest) : 1 };
}

/** The provenance label of a total: the single kind when all lines agree, otherwise 'mixed'. */
function summaryProvenance(lines: readonly WaterfallInput[]): string {
  const kinds = [...new Set(lines.filter((line) => line.value > 0).map((l) => l.provenance))];
  return kinds.length === 1 ? (kinds[0] ?? 'mixed') : 'mixed';
}

/** Horizontal extent of a bar on a scale; a zero-value bar keeps a hairline so it is still seen. */
export function barSpan(
  bar: Pick<WaterfallBar, 'start' | 'end'>,
  scale: LinearScale,
  minWidth = 2,
): { x: number; width: number } {
  const x0 = scale(bar.start);
  const x1 = scale(bar.end);
  const width = Math.max(minWidth, Math.abs(x1 - x0));
  return { x: Math.min(x0, x1), width };
}
