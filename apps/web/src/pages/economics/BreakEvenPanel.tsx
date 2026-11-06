import { useState } from 'react';
import type { EconomicsReport } from '@bigforge/schemas';
import {
  Chip,
  EmptyState,
  Panel,
  Provenance,
  Summary,
  formatCount,
  formatTokens,
  plural,
} from '../../ui';
import {
  BreakEvenChart,
  Segmented,
  breakEvenGap,
  breakEvenGeometry,
  chartWindow,
  seriesIncrements,
  wholeExecutions,
  type ChartWindowMode,
} from '../../viz/charts';
import {
  breakEvenAriaLabel,
  describeBigforgeIncrement,
  explainBreakEvenGap,
  plottedBasisSentence,
  tokenProvenance,
} from './model';

function compact(value: number): string {
  return formatTokens(value, { compact: true });
}

function LegendSwatch({ kind }: { kind: 'solid' | 'dashed' | 'band' | 'diamond' | 'cross' }) {
  return (
    <svg
      className="econ-legend__swatch"
      width="28"
      height="12"
      viewBox="0 0 28 12"
      aria-hidden="true"
      focusable="false"
    >
      {kind === 'solid' ? (
        <line x1="1" x2="27" y1="6" y2="6" className="econ-legend__line" />
      ) : null}
      {kind === 'dashed' ? (
        <line
          x1="1"
          x2="27"
          y1="6"
          y2="6"
          className="econ-legend__line econ-legend__line--dashed"
        />
      ) : null}
      {kind === 'band' ? (
        <rect x="1" y="1" width="26" height="10" className="econ-legend__band" />
      ) : null}
      {kind === 'diamond' ? (
        <path d="M14 0 l6 6 l-6 6 l-6 -6 Z" className="econ-legend__diamond" />
      ) : null}
      {kind === 'cross' ? <circle cx="14" cy="6" r="4.5" className="econ-legend__cross" /> : null}
    </svg>
  );
}

/** Cumulative tokens: the baseline pays per execution, BigForge pays its investment first. */
export function BreakEvenPanel({ report }: { report: EconomicsReport }) {
  const [mode, setMode] = useState<ChartWindowMode>('horizon');
  const geometry = breakEvenGeometry(report.series, report.perExecution.interval);
  const live = report.reuse.liveExecutions;

  if (!geometry) {
    return (
      <div className="econ-cell" data-testid="econ-breakeven">
        <Panel title="Break-even" subtitle="Cumulative tokens against executions">
          <EmptyState
            compact
            title="No curve yet"
            description="The curve appears once there is a per-execution saving to draw."
          />
        </Panel>
      </div>
    );
  }

  const view = chartWindow(geometry, mode, live);
  const gap = breakEvenGap(geometry, report.projected.breakEvenExecutions);
  const gapText = explainBreakEvenGap(report, gap);
  const increments = seriesIncrements(report.series);
  const crossing = geometry.crossing;
  const interval = geometry.crossingInterval;
  const crossingText =
    crossing === null
      ? `The lines do not cross within ${formatCount(geometry.horizon)} executions.`
      : `The lines cross at about ${formatCount(wholeExecutions(crossing))} executions${interval ? ` (${formatCount(wholeExecutions(interval.low))} to ${interval.high === null ? 'never' : formatCount(wholeExecutions(interval.high))} across the interval)` : ''}.`;

  return (
    <div className="econ-cell" data-testid="econ-breakeven">
      <Panel
        title="Break-even"
        subtitle="Cumulative tokens: the baseline pays on every execution, BigForge pays its investment first."
        actions={
          <Segmented
            label="Chart range"
            value={mode}
            onChange={setMode}
            options={[
              { value: 'horizon', label: `Whole projection (${formatCount(geometry.horizon)})` },
              {
                value: 'focus',
                label: 'Around break-even',
                disabled: !view.canFocus,
                title: view.canFocus
                  ? 'Zoom to the early executions'
                  : 'The whole projection is already close to break-even',
              },
            ]}
          />
        }
      >
        <ul className="econ-legend">
          <li>
            <LegendSwatch kind="solid" />
            Realized: {live === 0 ? 'no live execution yet' : plural(live, 'live execution')}
          </li>
          <li>
            <LegendSwatch kind="dashed" />
            Projected to {formatCount(geometry.horizon)}: an extrapolation, not a forecast
          </li>
          <li>
            <LegendSwatch kind="band" />
            95% interval of the per-execution saving
          </li>
          <li>
            <LegendSwatch kind="cross" />
            Where the plotted lines cross
          </li>
          {gap.differs ? (
            <li>
              <LegendSwatch kind="diamond" />
              Break-even in the report
            </li>
          ) : null}
        </ul>

        <BreakEvenChart
          series={report.series}
          geometry={geometry}
          xMax={view.xMax}
          liveExecutions={live}
          reportedBreakEven={report.projected.breakEvenExecutions}
          showReported={gap.differs}
          formatAxis={compact}
          formatValue={(value) => formatTokens(value, { compact: true })}
          ariaLabel={breakEvenAriaLabel(report, crossing, view.xMax, increments)}
        />

        <p className="econ-note">
          <Provenance kind={tokenProvenance(report)} metric="tokens_per_task" />
          <span>{crossingText}</span>
        </p>
        <p className="econ-note">
          <span>{plottedBasisSentence(report, increments)}</span>
        </p>
        {gapText ? (
          <p className="econ-note econ-note--gap" role="note">
            <Chip tone="amber" size="sm" dashed>
              Why two break-evens
            </Chip>
            <span>{gapText}</span>
          </p>
        ) : null}

        <Summary
          caption="Cumulative tokens by executions"
          description={`${increments ? `Baseline cumulative tokens grow by ${formatTokens(Math.round(increments.baseline))} per execution. ` : ''}BigForge starts at its ${formatTokens(report.investment.totalTokens)}-token investment ${describeBigforgeIncrement(increments?.bigforge ?? null)}. Both slopes are read from the plotted series, which uses the same executions as the headline saving. ${crossingText} Executions up to ${formatCount(live)} are realized; the rest are projected.`}
          rows={report.series}
          getRowId={(row) => String(row.execution)}
          columns={[
            {
              id: 'n',
              header: 'Executions',
              cell: (row) => formatCount(row.execution),
              mono: true,
              align: 'end',
            },
            {
              id: 'basis',
              header: 'Realized or projected',
              cell: (row) => (row.execution <= live ? 'realized' : 'projected'),
            },
            {
              id: 'base',
              header: 'Baseline tokens',
              cell: (row) => formatCount(row.baselineCumulative),
              mono: true,
              align: 'end',
            },
            {
              id: 'band',
              header: 'Baseline 95% band',
              cell: (row) =>
                geometry.halfSlope > 0
                  ? `${formatCount(Math.max(0, row.baselineCumulative - geometry.halfSlope * row.execution))} to ${formatCount(row.baselineCumulative + geometry.halfSlope * row.execution)}`
                  : '\u2014',
              mono: true,
              align: 'end',
            },
            {
              id: 'bf',
              header: 'BigForge tokens',
              cell: (row) => formatCount(row.bigforgeCumulative),
              mono: true,
              align: 'end',
            },
            {
              id: 'ahead',
              header: 'BigForge ahead by',
              cell: (row) => formatCount(row.baselineCumulative - row.bigforgeCumulative),
              mono: true,
              align: 'end',
            },
          ]}
        />
      </Panel>
    </div>
  );
}
