import type { CompileReport, ReflexStep, StepKind } from '@bigforge/schemas';

/**
 * Reflex DNA: the compile alignment as a genome strip. Pure model and geometry (no React): rows are the
 * source traces, columns the aligned behaviours in consensus order, and the strand below holds the compiled
 * steps with bar height = the baseline tokens each one replaces (synthetic). Everything the drawing needs
 * is computed here so it can be tested and so the text equivalent reads from the same model.
 */

export type DnaClass = 'invariant' | 'common' | 'variable';
export type DnaStatus = 'compiled' | 'excluded' | 'uncovered';

export interface DnaColumn {
  key: string;
  /** Human label: the behaviour purpose with spaces. */
  label: string;
  kind: 'turn' | 'decision';
  classification: DnaClass;
  conservation: number;
  presentIn: number;
  meanPosition: number;
  /** Mean baseline tokens spent on this behaviour (synthetic). */
  baselineTokens: number;
  variableSlots: string[];
  /** The operator that reproduces the behaviour on every trace, as `id@version`, if any. */
  replacedBy: string | null;
  status: DnaStatus;
  excludedReason: string | null;
  excludedOccurrences: number;
  stepIds: string[];
}

export interface DnaCell {
  key: string;
  present: boolean;
  count: number;
  detail: string;
}

export interface DnaRow {
  traceId: string;
  scenarioId: string;
  variantKey: string;
  cells: DnaCell[];
}

export interface DnaAlternative {
  operator: string;
  consistent: boolean;
  matched: number;
  of: number;
}

export interface DnaStep {
  id: string;
  title: string;
  kind: StepKind;
  operator: string;
  tokens: number;
  conservation: number;
  columnKeys: string[];
  alternatives: DnaAlternative[];
  reason: string;
  /** The step can cross an uncertainty boundary. */
  hasBoundary: boolean;
}

export interface DnaLink {
  columnKey: string;
  stepId: string;
}

export interface DnaStats {
  traces: number;
  behaviours: number;
  invariant: number;
  common: number;
  variable: number;
  excluded: number;
  uncovered: number;
  steps: number;
  /** Steps that replace no recorded behaviour (compiler-added guards and verification). */
  addedSteps: number;
}

export interface DnaModel {
  columns: DnaColumn[];
  rows: DnaRow[];
  steps: DnaStep[];
  links: DnaLink[];
  /** Behaviours the report names as uncovered that have no column of their own. */
  orphanUncovered: string[];
  stats: DnaStats;
}

export const columnLabel = (key: string): string => key.replaceAll('_', ' ');

const byPosition = (
  a: { meanPosition: number; key: string },
  b: { meanPosition: number; key: string },
): number => a.meanPosition - b.meanPosition || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function buildDna(report: CompileReport, steps: readonly ReflexStep[]): DnaModel {
  const excluded = new Map(report.excludedBehaviours.map((e) => [e.purpose, e]));
  const uncovered = new Set(report.uncovered);
  const decisions = new Map(report.decisions.map((d) => [d.stepId, d]));

  const stepsByColumn = new Map<string, string[]>();
  const links: DnaLink[] = [];
  const known = new Set(report.columns.map((c) => c.key));
  for (const step of steps) {
    for (const key of step.rationale.replaces) {
      if (!known.has(key)) continue;
      links.push({ columnKey: key, stepId: step.id });
      stepsByColumn.set(key, [...(stepsByColumn.get(key) ?? []), step.id]);
    }
  }
  // A column whose operator is named but that no step lists is linked through the operator instead.
  for (const column of report.columns) {
    if (!column.replacedBy || stepsByColumn.has(column.key)) continue;
    for (const step of steps) {
      if (`${step.operator.id}@${step.operator.version}` !== column.replacedBy) continue;
      links.push({ columnKey: column.key, stepId: step.id });
      stepsByColumn.set(column.key, [...(stepsByColumn.get(column.key) ?? []), step.id]);
    }
  }

  const columns: DnaColumn[] = [...report.columns].sort(byPosition).map((column) => {
    const skip = excluded.get(column.key);
    const stepIds = stepsByColumn.get(column.key) ?? [];
    const status: DnaStatus = skip
      ? 'excluded'
      : uncovered.has(column.key) || (column.replacedBy === null && stepIds.length === 0)
        ? 'uncovered'
        : 'compiled';
    return {
      key: column.key,
      label: columnLabel(column.key),
      kind: column.kind,
      classification: column.classification,
      conservation: column.conservation,
      presentIn: column.presentIn,
      meanPosition: column.meanPosition,
      baselineTokens: column.baselineTokens,
      variableSlots: column.variableSlots,
      replacedBy: column.replacedBy,
      status,
      excludedReason: skip?.reason ?? null,
      excludedOccurrences: skip?.occurrences ?? 0,
      stepIds,
    };
  });

  const order = columns.map((c) => c.key);
  const rows: DnaRow[] = report.rows.map((row) => {
    const byKey = new Map(row.cells.map((cell) => [cell.key, cell]));
    return {
      traceId: row.traceId,
      scenarioId: row.scenarioId,
      variantKey: row.variantKey,
      cells: order.map((key) => {
        const cell = byKey.get(key);
        return cell
          ? { key, present: cell.present, count: cell.count, detail: cell.detail }
          : { key, present: false, count: 0, detail: '' };
      }),
    };
  });

  const dnaSteps: DnaStep[] = steps.map((step) => {
    const decision = decisions.get(step.id);
    const alternatives = (decision?.alternatives ?? step.rationale.alternatives).map((alt) => ({
      operator: alt.operator,
      consistent: alt.consistent,
      matched: alt.matched,
      of: alt.of,
    }));
    return {
      id: step.id,
      title: step.title,
      kind: step.kind,
      operator: `${step.operator.id}@${step.operator.version}`,
      tokens: step.rationale.baselineTokens,
      conservation: step.rationale.conservation,
      columnKeys: step.rationale.replaces.filter((key) => known.has(key)),
      alternatives,
      reason: decision?.reason ?? step.rationale.selectedBecause,
      hasBoundary: step.boundary !== undefined,
    };
  });

  const count = (cls: DnaClass): number =>
    columns.filter((c) => c.classification === cls && c.status !== 'excluded').length;
  return {
    columns,
    rows,
    steps: dnaSteps,
    links,
    orphanUncovered: report.uncovered.filter((key) => !known.has(key)),
    stats: {
      traces: report.rows.length,
      behaviours: columns.length,
      invariant: count('invariant'),
      common: count('common'),
      variable: count('variable'),
      excluded: columns.filter((c) => c.status === 'excluded').length,
      uncovered:
        columns.filter((c) => c.status === 'uncovered').length +
        report.uncovered.filter((key) => !known.has(key)).length,
      steps: dnaSteps.length,
      addedSteps: dnaSteps.filter((s) => s.columnKeys.length === 0).length,
    },
  };
}

/* ------------------------------------------------------------------------------------------------
 * Geometry
 * ---------------------------------------------------------------------------------------------- */

export interface DnaGeometryOptions {
  /** Available width in px. The drawing never gets narrower than its minimum and then scrolls. */
  width: number;
}

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DnaGeometry {
  width: number;
  height: number;
  gutter: number;
  cellW: number;
  /** Rotation (degrees) of the column labels (up) and step labels (down). */
  labelAngle: number;
  /** Characters kept in a drawn label before it is cut with an ellipsis. */
  labelChars: number;
  labelZone: { y: number; h: number };
  bars: { y: number; h: number };
  matrix: { y: number; rowH: number; rowGap: number; h: number };
  ribbons: { y: number; h: number };
  strand: { y: number; maxBarH: number; labelY: number; tokenY: number; labelZoneH: number };
  columns: (Box & { key: string; cx: number; barH: number })[];
  rows: { traceId: string; y: number; h: number; cells: (Box & { key: string })[] }[];
  steps: (Box & { id: string; cx: number; barH: number })[];
  ribbonPaths: { columnKey: string; stepId: string; d: string; weight: number }[];
}

const GUTTER_WIDE = 292;
const GUTTER_NARROW = 56;
const RIGHT_PAD = 96;
const MIN_CELL = 42;
const MAX_CELL = 74;
const LABEL_CHARS = 24;
const CHAR_W = 6.3;
const ANGLE = 52;
const BAR_H = 30;
const ROW_H = 24;
const ROW_GAP = 3;
const RIBBON_H = 58;
const MAX_STEP_BAR = 60;
const MIN_STEP_BAR = 4;
const STEP_LABEL_CHARS = 14;

const round1 = (value: number): number => Math.round(value * 10) / 10;

/** Bar height for a step: linear in tokens against the largest step, with a visible stub for zero. */
export function stepBarHeight(tokens: number, maxTokens: number, maxHeight = MAX_STEP_BAR): number {
  if (!(tokens > 0) || !(maxTokens > 0)) return MIN_STEP_BAR;
  return Math.max(MIN_STEP_BAR, round1((tokens / maxTokens) * maxHeight));
}

export function truncateLabel(text: string, chars: number): string {
  return text.length <= chars ? text : `${text.slice(0, Math.max(1, chars - 1))}\u2026`;
}

export function layoutDna(model: DnaModel, options: DnaGeometryOptions): DnaGeometry {
  const columnCount = Math.max(1, model.columns.length);
  const gutter = options.width >= 720 ? GUTTER_WIDE : GUTTER_NARROW;
  const fitted = Math.floor((options.width - gutter - RIGHT_PAD) / columnCount);
  const cellW = Math.min(MAX_CELL, Math.max(MIN_CELL, fitted));
  const plotW = cellW * columnCount;
  const width = gutter + plotW + RIGHT_PAD;

  const longest = Math.min(
    LABEL_CHARS,
    model.columns.reduce((max, c) => Math.max(max, c.label.length), 0),
  );
  const sin = Math.sin((ANGLE * Math.PI) / 180);
  const cos = Math.cos((ANGLE * Math.PI) / 180);
  const labelH = Math.ceil(longest * CHAR_W * sin + 14 * cos) + 8;

  const labelY = 0;
  const barsY = labelY + labelH + 6;
  const matrixY = barsY + BAR_H + 10;
  const rowCount = model.rows.length;
  const matrixH = rowCount * ROW_H + Math.max(0, rowCount - 1) * ROW_GAP;
  const ribbonY = matrixY + matrixH + 12;
  const strandY = ribbonY + RIBBON_H;
  const longestStep = Math.min(
    STEP_LABEL_CHARS,
    model.steps.reduce((max, s) => Math.max(max, s.id.length), 0),
  );
  const stepLabelH = Math.ceil(longestStep * CHAR_W * sin + 14 * cos) + 8;
  const tokenY = strandY + MAX_STEP_BAR + 16;
  const stepLabelY = tokenY + 8;
  const height = stepLabelY + stepLabelH + 4;

  const columns = model.columns.map((column, index) => {
    const x = gutter + index * cellW;
    return {
      key: column.key,
      x,
      y: barsY,
      w: cellW,
      h: BAR_H,
      cx: x + cellW / 2,
      barH: round1(Math.max(2, column.conservation * BAR_H)),
    };
  });
  const columnX = new Map(columns.map((c) => [c.key, c]));

  const rows = model.rows.map((row, rowIndex) => {
    const y = matrixY + rowIndex * (ROW_H + ROW_GAP);
    return {
      traceId: row.traceId,
      y,
      h: ROW_H,
      cells: row.cells.map((cell) => {
        const column = columnX.get(cell.key);
        return { key: cell.key, x: (column?.x ?? gutter) + 3, y, w: cellW - 6, h: ROW_H };
      }),
    };
  });

  const stepCount = Math.max(1, model.steps.length);
  const slotW = plotW / stepCount;
  const maxTokens = model.steps.reduce((max, s) => Math.max(max, s.tokens), 0);
  const steps = model.steps.map((step, index) => {
    const slotX = gutter + index * slotW;
    const w = Math.min(34, Math.max(14, slotW * 0.5));
    return {
      id: step.id,
      x: round1(slotX + (slotW - w) / 2),
      y: strandY,
      w: round1(w),
      h: MAX_STEP_BAR,
      cx: round1(slotX + slotW / 2),
      barH: stepBarHeight(step.tokens, maxTokens),
    };
  });
  const stepBox = new Map(steps.map((s) => [s.id, s]));

  const ribbonPaths = model.links.flatMap((link) => {
    const column = columnX.get(link.columnKey);
    const step = stepBox.get(link.stepId);
    if (!column || !step) return [];
    const x1 = column.cx;
    const y1 = ribbonY - 4;
    const x2 = step.cx;
    const y2 = strandY;
    const mid = (y1 + y2) / 2;
    const tokens = model.columns.find((c) => c.key === link.columnKey)?.baselineTokens ?? 0;
    return [
      {
        columnKey: link.columnKey,
        stepId: link.stepId,
        d: `M${round1(x1)} ${round1(y1)}C${round1(x1)} ${round1(mid)} ${round1(x2)} ${round1(mid)} ${round1(x2)} ${round1(y2)}`,
        weight: round1(0.9 + Math.min(1.6, tokens / 6000)),
      },
    ];
  });

  return {
    width,
    height,
    gutter,
    cellW,
    labelAngle: ANGLE,
    labelChars: LABEL_CHARS,
    labelZone: { y: labelY, h: labelH },
    bars: { y: barsY, h: BAR_H },
    matrix: { y: matrixY, rowH: ROW_H, rowGap: ROW_GAP, h: matrixH },
    ribbons: { y: ribbonY, h: RIBBON_H },
    strand: {
      y: strandY,
      maxBarH: MAX_STEP_BAR,
      labelY: stepLabelY,
      tokenY,
      labelZoneH: stepLabelH,
    },
    columns,
    rows,
    steps,
    ribbonPaths,
  };
}

/** Which columns and steps are connected to a selection, for highlighting. */
export function relatedTo(
  model: Pick<DnaModel, 'links'>,
  selection: { type: 'column'; key: string } | { type: 'step'; id: string } | null,
): { columns: Set<string>; steps: Set<string> } {
  const columns = new Set<string>();
  const steps = new Set<string>();
  if (!selection) return { columns, steps };
  if (selection.type === 'column') {
    columns.add(selection.key);
    for (const link of model.links) if (link.columnKey === selection.key) steps.add(link.stepId);
  } else {
    steps.add(selection.id);
    for (const link of model.links) if (link.stepId === selection.id) columns.add(link.columnKey);
  }
  return { columns, steps };
}
