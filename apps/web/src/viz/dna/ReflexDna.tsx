import type { CompileReport, ReflexStep } from '@bigforge/schemas';
import {
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Chip, Provenance, Summary, formatCount, formatPct, plural } from '../../ui';
import {
  type DnaColumn,
  type DnaModel,
  type DnaStep,
  buildDna,
  layoutDna,
  relatedTo,
  truncateLabel,
} from './dnaModel';
import { useMeasuredWidth } from './useMeasuredWidth';
import './dna.css';

export interface ReflexDnaProps {
  report: CompileReport;
  steps: readonly ReflexStep[];
  /** Names the drawing for assistive technology, for example "first-causal-error v1.0.0". */
  title: string;
  className?: string;
}

type Selection = { type: 'column'; key: string } | { type: 'step'; id: string };

const KIND_LABEL: Record<DnaStep['kind'], string> = {
  known: 'Known',
  validation: 'Validation',
  hybrid: 'Hybrid',
  boundary: 'Boundary',
  verification: 'Verification',
};

const CLASS_TEXT: Record<DnaColumn['classification'], string> = {
  invariant: 'Invariant',
  common: 'Common',
  variable: 'Variable',
};

function statusText(column: DnaColumn): string {
  if (column.status === 'excluded') return 'Excluded: not compiled';
  if (column.status === 'uncovered') return 'Uncovered: still model-driven';
  return CLASS_TEXT[column.classification];
}

function columnName(column: DnaColumn, traces: number): string {
  const base = `${column.label}. ${statusText(column)}. Present in ${column.presentIn} of ${traces} traces, ${formatPct(column.conservation, { digits: 0 })} conserved.`;
  return column.replacedBy ? `${base} Replaced by ${column.replacedBy}.` : base;
}

function stepName(step: DnaStep): string {
  return `${step.title}. ${KIND_LABEL[step.kind]} step, operator ${step.operator}. Replaces ${formatCount(step.tokens)} baseline tokens (synthetic).`;
}

const compact = (tokens: number): string => formatCount(tokens, { compact: true });

/** Wraps the roving-tabindex logic shared by the column and step tracks. */
function useRoving<K extends string>(keys: readonly K[]) {
  const refs = useRef(new Map<K, SVGGElement>());
  const [active, setActive] = useState<K | null>(null);
  const tabStop = active !== null && keys.includes(active) ? active : (keys[0] ?? null);
  const register = (key: K) => (element: SVGGElement | null) => {
    if (element) refs.current.set(key, element);
    else refs.current.delete(key);
  };
  const move = (event: KeyboardEvent, key: K): boolean => {
    const index = keys.indexOf(key);
    let next: number;
    switch (event.key) {
      case 'ArrowRight':
        next = Math.min(keys.length - 1, index + 1);
        break;
      case 'ArrowLeft':
        next = Math.max(0, index - 1);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = keys.length - 1;
        break;
      default:
        return false;
    }
    event.preventDefault();
    const target = keys[next];
    if (target !== undefined) refs.current.get(target)?.focus();
    return true;
  };
  return { tabStop, register, move, setActive };
}

function Swatch({ children }: { children: ReactNode }) {
  return (
    <svg width={20} height={14} viewBox="0 0 20 14" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function Legend({ patternId }: { patternId: (tone: string) => string }) {
  return (
    <div className="dna__legend" aria-label="How to read the Reflex DNA">
      <div className="dna__legend-group">
        <span className="micro dna__legend-title">Conservation</span>
        <span className="dna__legend-item">
          <Swatch>
            <rect
              x="1"
              y="1"
              width="18"
              height="12"
              rx="2"
              className="dna__bar"
              data-class="invariant"
            />
          </Swatch>
          Invariant: in every trace
        </span>
        <span className="dna__legend-item">
          <Swatch>
            <rect
              x="1"
              y="1"
              width="18"
              height="12"
              rx="2"
              className="dna__bar"
              data-class="common"
            />
          </Swatch>
          Common
        </span>
        <span className="dna__legend-item">
          <Swatch>
            <rect
              x="1"
              y="1"
              width="18"
              height="12"
              rx="2"
              className="dna__bar"
              data-class="variable"
              fill={`url(#${patternId('steel')})`}
            />
          </Swatch>
          Variable: some traces only
        </span>
        <span className="dna__legend-item">
          <Swatch>
            <rect
              x="1"
              y="1"
              width="18"
              height="12"
              rx="2"
              className="dna__bar"
              data-status="excluded"
              fill={`url(#${patternId('crimson')})`}
            />
          </Swatch>
          Excluded: unsafe, never compiled
        </span>
      </div>
      <div className="dna__legend-group">
        <span className="micro dna__legend-title">Compiled steps</span>
        <span className="dna__legend-item">
          <Swatch>
            <rect x="3" y="1" width="14" height="12" rx="2" className="dna__stepbar" />
          </Swatch>
          Known
        </span>
        <span className="dna__legend-item">
          <svg
            className="dna__step"
            data-kind="validation"
            width={20}
            height={14}
            aria-hidden="true"
          >
            <rect x="3" y="1" width="14" height="12" rx="2" className="dna__stepbar" />
          </svg>
          Validation
        </span>
        <span className="dna__legend-item">
          <svg className="dna__step" data-kind="hybrid" width={20} height={14} aria-hidden="true">
            <rect x="3" y="1" width="14" height="12" rx="2" className="dna__stepbar" />
            <path className="dna__notch" d="M3 1h7L3 8z" />
          </svg>
          Hybrid (may cross its boundary)
        </span>
        <span className="dna__legend-item">
          <svg className="dna__step" data-kind="boundary" width={20} height={14} aria-hidden="true">
            <rect x="3" y="1" width="14" height="12" rx="2" className="dna__stepbar" />
          </svg>
          Boundary
        </span>
        <span className="dna__legend-item">
          <svg
            className="dna__step"
            data-kind="verification"
            width={20}
            height={14}
            aria-hidden="true"
          >
            <rect x="3" y="1" width="14" height="12" rx="2" className="dna__stepbar" />
          </svg>
          Verification
        </span>
      </div>
    </div>
  );
}

function Overview({ model, report }: { model: DnaModel; report: CompileReport }) {
  const { stats } = model;
  return (
    <div>
      <h3>What the alignment found</h3>
      <dl className="dna__stats">
        <div>
          <dd>{stats.traces}</dd>
          <dt>source traces</dt>
        </div>
        <div>
          <dd>{stats.behaviours}</dd>
          <dt>aligned behaviours</dt>
        </div>
        <div>
          <dd>{stats.invariant}</dd>
          <dt>invariant</dt>
        </div>
        <div>
          <dd>{stats.variable + stats.common}</dd>
          <dt>variable or common</dt>
        </div>
        <div>
          <dd>{stats.excluded}</dd>
          <dt>excluded as unsafe</dt>
        </div>
        <div>
          <dd>{stats.steps}</dd>
          <dt>compiled steps</dt>
        </div>
      </dl>
      <p className="dna__note">
        Behaviours that appear in every trace are kept as deterministic steps only if a typed
        operator reproduces them on <strong>every</strong> trace; variable behaviours are folded
        into a step that decides locally or crosses its uncertainty boundary.{' '}
        {stats.addedSteps > 0
          ? `${plural(stats.addedSteps, 'step')} replace no recorded behaviour: the compiler added them as guards and verification. `
          : ''}
        Select a behaviour or a step to see how it was decided.
      </p>
      <p className="dna__note">
        Baseline per task: {formatCount(report.baselineTokensPerTask)} tokens and{' '}
        {report.baselineModelCallsPerTask} model calls <Provenance kind="synthetic" />
      </p>
    </div>
  );
}

function ColumnDetail({ column, model }: { column: DnaColumn; model: DnaModel }) {
  const traces = model.stats.traces;
  const steps = column.stepIds
    .map((id) => model.steps.find((s) => s.id === id))
    .filter((s): s is DnaStep => s !== undefined);
  return (
    <div>
      <h3>
        <span className="mono">{column.key}</span>
      </h3>
      <div className="dna__chips" style={{ marginTop: 8 }}>
        <Chip
          tone={
            column.status === 'excluded'
              ? 'crimson'
              : column.status === 'uncovered'
                ? 'ember'
                : column.classification === 'invariant'
                  ? 'steel'
                  : 'ash'
          }
          variant="outline"
          dashed={column.classification === 'variable' || column.status !== 'compiled'}
        >
          {statusText(column)}
        </Chip>
        <Chip tone="neutral" variant="outline">
          {column.kind === 'turn' ? 'Model turn' : 'Decision annotation'}
        </Chip>
      </div>
      <dl className="dna__facts">
        <dt>Present in</dt>
        <dd>
          {column.presentIn} of {traces} traces ({formatPct(column.conservation, { digits: 0 })}{' '}
          conserved)
        </dd>
        <dt>Mean position</dt>
        <dd>{formatPct(column.meanPosition, { digits: 0 })} of the way through a trace</dd>
        <dt>Baseline tokens</dt>
        <dd>
          {column.kind === 'decision'
            ? 'none (an annotation, not a model turn)'
            : formatCount(column.baselineTokens)}{' '}
          {column.kind === 'decision' ? null : <Provenance kind="synthetic" />}
        </dd>
        {column.variableSlots.length > 0 ? (
          <>
            <dt>Varies in</dt>
            <dd className="dna__chips">
              {column.variableSlots.map((slot) => (
                <Chip key={slot} mono size="sm" tone="neutral" variant="outline">
                  {slot}
                </Chip>
              ))}
            </dd>
          </>
        ) : null}
        <dt>Replaced by</dt>
        <dd>
          {column.replacedBy ? (
            <span className="mono">{column.replacedBy}</span>
          ) : (
            'no operator: it stays with the model'
          )}
          {steps.length > 0 ? (
            <>
              {' '}
              in step{steps.length > 1 ? 's' : ''} {steps.map((s) => s.id).join(', ')}
            </>
          ) : null}
        </dd>
      </dl>
      {column.excludedReason ? (
        <p className="dna__note" data-tone="crimson">
          Excluded ({plural(column.excludedOccurrences, 'occurrence')}): {column.excludedReason}
        </p>
      ) : null}
      <dl className="dna__trace-list" aria-label={`${column.label} in each trace`}>
        {model.rows.map((row) => {
          const cell = row.cells.find((c) => c.key === column.key);
          return (
            <div key={row.traceId} style={{ display: 'contents' }}>
              <dt>{row.scenarioId}</dt>
              <dd data-absent={!cell?.present}>
                {cell?.present
                  ? `${cell.detail || 'present'}${cell.count > 1 ? ` (\u00d7${cell.count})` : ''}`
                  : 'absent'}
              </dd>
            </div>
          );
        })}
      </dl>
    </div>
  );
}

function StepDetail({ step, model }: { step: DnaStep; model: DnaModel }) {
  const columns = step.columnKeys
    .map((key) => model.columns.find((c) => c.key === key))
    .filter((c): c is DnaColumn => c !== undefined);
  return (
    <div>
      <h3>{step.title}</h3>
      <div className="dna__chips" style={{ marginTop: 8 }}>
        <Chip
          tone={
            step.kind === 'boundary' ? 'molten' : step.kind === 'verification' ? 'jade' : 'steel'
          }
          variant="outline"
          dashed={step.kind === 'validation'}
        >
          {KIND_LABEL[step.kind]}
        </Chip>
        {step.hasBoundary ? (
          <Chip tone="molten" variant="outline">
            Has an uncertainty boundary
          </Chip>
        ) : null}
      </div>
      <dl className="dna__facts">
        <dt>Operator chosen</dt>
        <dd className="mono">{step.operator}</dd>
        <dt>Replaces</dt>
        <dd>
          {columns.length === 0 ? (
            'no recorded behaviour: added by the compiler as a guard or verification'
          ) : (
            <span className="dna__chips">
              {columns.map((c) => (
                <Chip key={c.key} mono size="sm" tone="neutral" variant="outline">
                  {c.key}
                </Chip>
              ))}
            </span>
          )}
        </dd>
        <dt>Baseline tokens</dt>
        <dd>
          {formatCount(step.tokens)} replaced per task <Provenance kind="synthetic" />
        </dd>
        <dt>Why this operator</dt>
        <dd>{step.reason}</dd>
      </dl>
      <div className="dna__alts">
        <Summary
          label={`Operators that fit (${step.alternatives.length})`}
          defaultOpen
          description="Every typed operator tried for this step, and on how many source traces its output reproduced the recorded behaviour. Only operators that match on every trace may be chosen."
          caption={`Operator candidates for ${step.title}`}
          columns={[
            {
              id: 'op',
              header: 'Operator',
              mono: true,
              cell: (alt) => (
                <>
                  {alt.operator}
                  {alt.operator === step.operator ? ' (chosen)' : ''}
                </>
              ),
            },
            { id: 'ok', header: 'Reproduces', cell: (alt) => (alt.consistent ? 'Yes' : 'No') },
            {
              id: 'n',
              header: 'Matched',
              align: 'end',
              mono: true,
              cell: (alt) => `${alt.matched} of ${alt.of}`,
            },
          ]}
          rows={step.alternatives}
          getRowId={(alt) => alt.operator}
        />
      </div>
    </div>
  );
}

function AlignmentTables({ model }: { model: DnaModel }) {
  return (
    <div className="stack" style={{ '--gap': '12px' } as CSSProperties}>
      <Summary
        label="View the alignment as a table"
        description={`${model.stats.behaviours} behaviours across ${plural(model.stats.traces, 'source trace')}. Each trace column says whether the behaviour was present and how often.`}
        caption="Aligned behaviours by trace"
        rows={model.columns}
        getRowId={(c) => c.key}
        columns={[
          { id: 'behaviour', header: 'Behaviour', mono: true, cell: (c) => c.key },
          { id: 'class', header: 'Class', cell: (c) => statusText(c) },
          {
            id: 'cons',
            header: 'Conserved',
            align: 'end',
            mono: true,
            cell: (c) => `${c.presentIn} of ${model.stats.traces}`,
          },
          ...model.rows.map((row) => ({
            id: row.traceId,
            header: row.scenarioId,
            align: 'center' as const,
            cell: (c: DnaColumn) => {
              const cell = row.cells.find((x) => x.key === c.key);
              return cell?.present
                ? cell.count > 1
                  ? `present \u00d7${cell.count}`
                  : 'present'
                : 'absent';
            },
          })),
          {
            id: 'tokens',
            header: 'Tokens (synthetic)',
            align: 'end',
            mono: true,
            cell: (c) => formatCount(c.baselineTokens),
          },
          { id: 'op', header: 'Replaced by', mono: true, cell: (c) => c.replacedBy ?? 'none' },
        ]}
      />
      <Summary
        label="View the compiled steps as a table"
        description="The compiled strand in order, with the baseline tokens each step replaces and how many operators fit."
        caption="Compiled steps"
        rows={model.steps}
        getRowId={(s) => s.id}
        columns={[
          { id: 'id', header: 'Step', mono: true, cell: (s) => s.id },
          { id: 'kind', header: 'Kind', cell: (s) => KIND_LABEL[s.kind] },
          { id: 'op', header: 'Operator', mono: true, cell: (s) => s.operator },
          {
            id: 'rep',
            header: 'Replaces',
            cell: (s) => (s.columnKeys.length > 0 ? s.columnKeys.join(', ') : 'nothing (added)'),
          },
          {
            id: 'tok',
            header: 'Tokens (synthetic)',
            align: 'end',
            mono: true,
            cell: (s) => formatCount(s.tokens),
          },
          {
            id: 'alt',
            header: 'Operators fit',
            align: 'end',
            mono: true,
            cell: (s) => String(s.alternatives.filter((a) => a.consistent).length),
          },
        ]}
      />
    </div>
  );
}

/**
 * The compile alignment as a genome strip: rows are source traces, columns the aligned behaviours in
 * consensus order (header bar = conservation), and the strand below holds the compiled steps (bar height =
 * baseline tokens replaced, synthetic). Ribbons join each behaviour to the step that replaced it.
 */
export function ReflexDna({ report, steps, title, className }: ReflexDnaProps) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '_');
  const patternId = (tone: string) => `${uid}-hatch-${tone}`;
  const model = useMemo(() => buildDna(report, steps), [report, steps]);
  const [scrollRef, measured] = useMeasuredWidth();
  const geo = useMemo(() => layoutDna(model, { width: measured ?? 960 }), [model, measured]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const related = useMemo(() => relatedTo(model, selection), [model, selection]);

  const columnRoving = useRoving(model.columns.map((c) => c.key));
  const stepRoving = useRoving(model.steps.map((s) => s.id));

  const toggle = (next: Selection) => {
    setSelection((current) =>
      current &&
      current.type === next.type &&
      (current.type === 'column'
        ? current.key === (next as typeof current).key
        : current.id === (next as typeof current).id)
        ? null
        : next,
    );
  };

  const selectedColumn =
    selection?.type === 'column' ? model.columns.find((c) => c.key === selection.key) : undefined;
  const selectedStep =
    selection?.type === 'step' ? model.steps.find((s) => s.id === selection.id) : undefined;
  const announcement = selectedColumn
    ? `Selected behaviour ${selectedColumn.label}. ${statusText(selectedColumn)}.`
    : selectedStep
      ? `Selected step ${selectedStep.title}, operator ${selectedStep.operator}.`
      : '';

  const matrixBottom = geo.matrix.y + geo.matrix.h;
  const plotLeft = geo.gutter;
  const plotRight = geo.gutter + geo.cellW * model.columns.length;
  const narrow = geo.gutter < 100;
  const columnByKey = new Map(model.columns.map((c) => [c.key, c]));

  return (
    <div
      className={className ? `dna ${className}` : 'dna'}
      data-has-selection={selection ? 'true' : 'false'}
    >
      <div className="dna__scroll" ref={scrollRef}>
        <svg
          className="dna__svg"
          width={geo.width}
          height={geo.height}
          viewBox={`0 0 ${geo.width} ${geo.height}`}
          role="group"
          aria-label={`Reflex DNA of ${title}: ${plural(model.stats.traces, 'source trace')} aligned over ${plural(model.stats.behaviours, 'behaviour')}, and ${plural(model.stats.steps, 'compiled step')}. The same data is in the tables below.`}
          focusable="false"
        >
          <defs>
            {(['steel', 'crimson', 'ember'] as const).map((tone) => (
              <pattern
                key={tone}
                id={patternId(tone)}
                width="6"
                height="6"
                patternUnits="userSpaceOnUse"
                patternTransform="rotate(45)"
              >
                <line className="dna__hatch-line" data-tone={tone} x1="0" y1="0" x2="0" y2="6" />
              </pattern>
            ))}
          </defs>

          {/* axis captions */}
          {!narrow ? (
            <g aria-hidden="true">
              <text
                className="dna__axis"
                x={plotLeft - 12}
                y={geo.bars.y + geo.bars.h / 2 + 4}
                textAnchor="end"
              >
                Conservation
              </text>
              <text className="dna__axis" x={plotLeft - 12} y={geo.matrix.y - 4} textAnchor="end">
                Source traces
              </text>
              <text className="dna__axis" x={plotLeft - 12} y={geo.strand.y + 18} textAnchor="end">
                Compiled steps
              </text>
              <text className="dna__axis" x={plotLeft - 12} y={geo.strand.y + 34} textAnchor="end">
                tokens replaced
              </text>
            </g>
          ) : null}

          {/* columns: highlight band, angled label, conservation bar */}
          {model.columns.map((column, index) => {
            const box = geo.columns[index];
            if (!box) return null;
            const selected = selection?.type === 'column' && selection.key === column.key;
            const isRelated = related.columns.has(column.key);
            const fillPattern =
              column.status === 'excluded'
                ? patternId('crimson')
                : column.status === 'uncovered'
                  ? patternId('ember')
                  : patternId('steel');
            const hatched = column.classification === 'variable' || column.status !== 'compiled';
            const bandTop = geo.bars.y - 3;
            return (
              <g
                key={column.key}
                className="dna__col"
                role="button"
                tabIndex={columnRoving.tabStop === column.key ? 0 : -1}
                aria-label={columnName(column, model.stats.traces)}
                aria-pressed={selected}
                data-status={column.status}
                data-class={column.classification}
                data-selected={selected ? 'true' : undefined}
                data-related={isRelated ? 'true' : undefined}
                ref={columnRoving.register(column.key)}
                onClick={() => {
                  toggle({ type: 'column', key: column.key });
                }}
                onFocus={() => {
                  columnRoving.setActive(column.key);
                }}
                onKeyDown={(event) => {
                  if (columnRoving.move(event, column.key)) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle({ type: 'column', key: column.key });
                  } else if (event.key === 'Escape') {
                    setSelection(null);
                  }
                }}
              >
                <rect
                  className="dna__col-hit"
                  x={box.x + 1}
                  y={bandTop}
                  width={box.w - 2}
                  height={matrixBottom - bandTop + 3}
                  rx={4}
                />
                <rect
                  className="dna__col-focus"
                  x={box.x + 1}
                  y={bandTop}
                  width={box.w - 2}
                  height={matrixBottom - bandTop + 3}
                  rx={4}
                />
                <text
                  className="dna__collabel"
                  transform={`translate(${box.cx - 3} ${geo.bars.y - 8}) rotate(${-geo.labelAngle})`}
                >
                  {truncateLabel(column.label, geo.labelChars)}
                  <title>{column.label}</title>
                </text>
                <rect
                  className="dna__track"
                  x={box.x + 6}
                  y={geo.bars.y}
                  width={box.w - 12}
                  height={geo.bars.h}
                  rx={2}
                />
                <rect
                  className="dna__bar"
                  data-class={column.classification}
                  data-status={column.status}
                  x={box.x + 6}
                  y={geo.bars.y + geo.bars.h - box.barH}
                  width={box.w - 12}
                  height={box.barH}
                  rx={2}
                  {...(hatched ? { fill: `url(#${fillPattern})` } : {})}
                />
              </g>
            );
          })}

          {/* alignment matrix */}
          <g>
            {model.rows.map((row, rowIndex) => {
              const rowGeo = geo.rows[rowIndex];
              if (!rowGeo) return null;
              const text = `${row.scenarioId}  ${row.variantKey}`;
              return (
                <g key={row.traceId} className="dna__rowlabel">
                  <text x={plotLeft - 12} y={rowGeo.y + rowGeo.h / 2 + 4} textAnchor="end">
                    <tspan className="dna__rowid">{row.scenarioId}</tspan>
                    {!narrow ? (
                      <tspan className="dna__rowvariant" dx="8">
                        {truncateLabel(row.variantKey, 38)}
                      </tspan>
                    ) : null}
                    <title>{text}</title>
                  </text>
                  {row.cells.map((cell, cellIndex) => {
                    const cellGeo = rowGeo.cells[cellIndex];
                    const column = columnByKey.get(cell.key);
                    if (!cellGeo || !column) return null;
                    const isRelated = related.columns.has(cell.key);
                    return (
                      <g key={cell.key} className="dna__cell-group">
                        <rect
                          className="dna__cell"
                          x={cellGeo.x}
                          y={cellGeo.y + 2}
                          width={cellGeo.w}
                          height={cellGeo.h - 4}
                          rx={3}
                          data-present={cell.present}
                          data-class={column.classification}
                          data-status={column.status}
                          data-related={isRelated ? 'true' : undefined}
                        >
                          <title>
                            {`${row.scenarioId} \u00b7 ${column.label}: ${cell.present ? `present${cell.count > 1 ? ` \u00d7${cell.count}` : ''}${cell.detail ? ` \u00b7 ${cell.detail}` : ''}` : 'absent'}`}
                          </title>
                        </rect>
                        {cell.present && cell.count > 1 ? (
                          <text
                            className="dna__count"
                            x={cellGeo.x + cellGeo.w / 2}
                            y={cellGeo.y + cellGeo.h / 2 + 4}
                            textAnchor="middle"
                          >
                            {`\u00d7${cell.count}`}
                          </text>
                        ) : null}
                      </g>
                    );
                  })}
                </g>
              );
            })}
          </g>

          {/* ribbons: each behaviour to the step that replaced it */}
          <g aria-hidden="true">
            {geo.ribbonPaths.map((ribbon) => {
              const active =
                (selection?.type === 'column' && selection.key === ribbon.columnKey) ||
                (selection?.type === 'step' && selection.id === ribbon.stepId);
              return (
                <path
                  key={`${ribbon.columnKey}>${ribbon.stepId}`}
                  className="dna__ribbon"
                  d={ribbon.d}
                  strokeWidth={ribbon.weight}
                  data-active={active ? 'true' : undefined}
                  data-status={columnByKey.get(ribbon.columnKey)?.status}
                />
              );
            })}
          </g>

          {/* strand: backbone, nodes, bars hanging by baseline tokens */}
          <line
            className="dna__backbone"
            x1={plotLeft}
            x2={plotRight}
            y1={geo.strand.y}
            y2={geo.strand.y}
            aria-hidden="true"
          />
          {model.steps.map((step, index) => {
            const box = geo.steps[index];
            if (!box) return null;
            const selected = selection?.type === 'step' && selection.id === step.id;
            const isRelated = related.steps.has(step.id);
            const empty = !(step.tokens > 0);
            return (
              <g
                key={step.id}
                className="dna__step"
                role="button"
                tabIndex={stepRoving.tabStop === step.id ? 0 : -1}
                aria-label={stepName(step)}
                aria-pressed={selected}
                data-kind={step.kind}
                data-selected={selected ? 'true' : undefined}
                data-related={isRelated ? 'true' : undefined}
                ref={stepRoving.register(step.id)}
                onClick={() => {
                  toggle({ type: 'step', id: step.id });
                }}
                onFocus={() => {
                  stepRoving.setActive(step.id);
                }}
                onKeyDown={(event) => {
                  if (stepRoving.move(event, step.id)) return;
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    toggle({ type: 'step', id: step.id });
                  } else if (event.key === 'Escape') {
                    setSelection(null);
                  }
                }}
              >
                <rect
                  className="dna__step-hit"
                  x={box.cx - geo.cellW / 2 + 2}
                  y={geo.strand.y - 6}
                  width={geo.cellW - 4}
                  height={geo.strand.tokenY - geo.strand.y + 12}
                  rx={4}
                />
                <rect
                  className="dna__step-focus"
                  x={box.cx - geo.cellW / 2 + 2}
                  y={geo.strand.y - 6}
                  width={geo.cellW - 4}
                  height={geo.strand.tokenY - geo.strand.y + 12}
                  rx={4}
                />
                <rect
                  className="dna__stepbar"
                  data-empty={empty ? 'true' : undefined}
                  x={box.x}
                  y={geo.strand.y + 6}
                  width={box.w}
                  height={box.barH}
                  rx={2}
                />
                {step.kind === 'hybrid' ? (
                  <path
                    className="dna__notch"
                    d={`M${box.x} ${geo.strand.y + 6}h${Math.min(12, box.w)}l-${Math.min(12, box.w)} ${Math.min(12, box.barH)}z`}
                  />
                ) : null}
                <circle className="dna__node" cx={box.cx} cy={geo.strand.y} r={4.5} />
                <text
                  className="dna__tokens"
                  data-zero={empty ? 'true' : undefined}
                  x={box.cx}
                  y={geo.strand.tokenY}
                >
                  {compact(step.tokens)}
                </text>
                <text
                  className="dna__steplabel"
                  transform={`translate(${box.cx - 4} ${geo.strand.labelY}) rotate(${geo.labelAngle})`}
                >
                  {truncateLabel(step.id, 14)}
                  <title>{step.title}</title>
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <Legend patternId={patternId} />

      <div className="dna__inspector">
        <div>
          {selectedColumn ? (
            <ColumnDetail column={selectedColumn} model={model} />
          ) : selectedStep ? (
            <StepDetail step={selectedStep} model={model} />
          ) : (
            <Overview model={model} report={report} />
          )}
        </div>
        <div>
          <h3>Left out of the Reflex</h3>
          {model.stats.excluded + model.stats.uncovered === 0 ? (
            <p className="dna__note">
              Nothing was excluded and every behaviour is covered by a compiled step.
            </p>
          ) : (
            <ul className="stack" style={{ '--gap': '10px', marginTop: 12 } as CSSProperties}>
              {model.columns
                .filter((c) => c.status !== 'compiled')
                .map((c) => (
                  <li key={c.key}>
                    <Chip
                      tone={c.status === 'excluded' ? 'crimson' : 'ember'}
                      variant="outline"
                      dashed
                      mono
                    >
                      {c.key}
                    </Chip>
                    <p
                      className="dna__note"
                      style={{ marginTop: 6 }}
                      data-tone={c.status === 'excluded' ? 'crimson' : undefined}
                    >
                      {c.status === 'excluded'
                        ? `Excluded, seen ${plural(c.excludedOccurrences, 'time')}: ${c.excludedReason ?? ''}`
                        : 'No typed operator reproduces this behaviour on every trace, so it stays with the model.'}
                    </p>
                  </li>
                ))}
              {model.orphanUncovered.map((key) => (
                <li key={key}>
                  <Chip tone="ember" variant="outline" dashed mono>
                    {key}
                  </Chip>
                  <p className="dna__note" style={{ marginTop: 6 }}>
                    Reported as uncovered by the compiler.
                  </p>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <AlignmentTables model={model} />
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
