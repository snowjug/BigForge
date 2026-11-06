import { useState } from 'react';
import type { EconomicsReport } from '@bigforge/schemas';
import {
  EmptyState,
  Gauge,
  Panel,
  Provenance,
  Summary,
  formatCount,
  formatPct,
  formatTokens,
  formatUsd,
  plural,
} from '../../ui';
import { InvestmentWaterfall, Segmented, layoutWaterfall } from '../../viz/charts';
import {
  type Derived,
  formatRoi,
  formatRoiRange,
  realizedProvenance,
  savingBasisInfo,
  tokenProvenance,
} from './model';

type Unit = 'tokens' | 'usd';

/** What learning cost: a ledger waterfall in tokens (the ROI denominator) or in dollars (adds the review time). */
export function InvestmentPanel({ report }: { report: EconomicsReport }) {
  const [unit, setUnit] = useState<Unit>('tokens');
  const { lines } = report.investment;
  const tokens = unit === 'tokens';
  const layout = layoutWaterfall(
    lines.map((line) => ({
      id: line.id,
      label: line.label,
      value: tokens ? line.tokens : line.costUsd,
      counted: line.counted,
      provenance: line.provenance,
      note: line.note,
      runs: line.runs,
    })),
    {
      totalLabel: tokens ? 'Investment, tokens' : 'Investment, dollars with review',
      totalValue: tokens ? report.investment.totalTokens : report.investment.totalCostUsdWithReview,
    },
  );
  const format = tokens
    ? (value: number) => formatTokens(value)
    : (value: number) => formatUsd(value);
  const learning = lines.find((line) => line.id === 'learning');

  return (
    <div className="econ-cell" data-testid="econ-investment">
      <Panel
        title="Investment: what learning cost"
        subtitle={
          tokens
            ? 'Tokens are what the token ROI divides by. Compilation and replay spend no model tokens.'
            : 'Dollars add the assumed human review time, which tokens cannot show.'
        }
        actions={
          <Segmented
            label="Investment unit"
            value={unit}
            onChange={setUnit}
            options={[
              { value: 'tokens', label: 'Tokens' },
              { value: 'usd', label: 'Dollars' },
            ]}
          />
        }
      >
        <InvestmentWaterfall
          layout={layout}
          format={format}
          excludedNote="not counted"
          ariaLabel={`Investment ledger in ${tokens ? 'tokens' : 'dollars'}: ${lines
            .filter((line) => line.counted)
            .map((line) => `${line.label} ${format(tokens ? line.tokens : line.costUsd)}`)
            .join(', ')}; total ${format(layout.total)}.`}
        />
        {learning && !learning.counted ? (
          <p className="econ-note">
            <span>
              The dashed line is the {plural(learning.runs, 'learning-task baseline run')} (
              {tokens ? `${formatTokens(learning.tokens)} tokens` : formatUsd(learning.costUsd)}).
              Those tasks had to be solved anyway, so it is not counted. The conservative view in
              the assumptions counts it.
            </span>
          </p>
        ) : null}
        <Summary
          caption="Investment ledger"
          description="Every line of the investment with its provenance. A line that is not counted does not enter the total."
          rows={lines}
          getRowId={(line) => line.id}
          columns={[
            { id: 'line', header: 'Line', cell: (line) => line.label },
            {
              id: 'runs',
              header: 'Runs',
              cell: (line) => formatCount(line.runs),
              mono: true,
              align: 'end',
            },
            {
              id: 'tokens',
              header: 'Tokens',
              cell: (line) => formatTokens(line.tokens),
              mono: true,
              align: 'end',
            },
            {
              id: 'usd',
              header: 'Dollars',
              cell: (line) => formatUsd(line.costUsd),
              mono: true,
              align: 'end',
            },
            { id: 'prov', header: 'Provenance', cell: (line) => line.provenance },
            {
              id: 'counted',
              header: 'Counted',
              cell: (line) => (line.counted ? 'yes' : 'no, excluded by default'),
            },
            { id: 'note', header: 'Note', cell: (line) => line.note },
          ]}
        />
      </Panel>
    </div>
  );
}

/** The saving of one execution, its basis in plain words, and the two means it comes from. */
export function SavingPanel({ report, derived }: { report: EconomicsReport; derived: Derived }) {
  const { baseline, reuse, perExecution } = report;
  const basis = savingBasisInfo(perExecution.basis);
  const interval = perExecution.interval;
  const hasInterval = interval.high > interval.low;

  return (
    <div className="econ-cell" data-testid="econ-saving">
      <Panel
        title="Saving per execution"
        subtitle="What one execution through a Reflex avoids, and how we know."
      >
        <div className="econ-saving__head">
          <div>
            <p className="econ-saving__value num">
              {formatTokens(perExecution.tokensAvoided)} <span>tokens</span>
            </p>
            <p className="econ-saving__sub">
              {hasInterval
                ? `95% interval ${formatTokens(interval.low)} to ${formatTokens(interval.high)} · `
                : ''}
              {formatUsd(perExecution.costAvoidedUsd, { digits: 4 })} in dollars
            </p>
          </div>
          <div className="econ-saving__basis" data-tone={basis.tone}>
            <span className="micro">Basis</span>
            <strong>{basis.label}</strong>
            <Provenance kind={perExecution.provenance} metric="tokens_per_task" />
          </div>
        </div>
        <p className="econ-saving__words">{basis.words}</p>

        <div
          className="bf-table-wrap"
          role="region"
          aria-label="Baseline and Reflex means per execution"
          tabIndex={0}
        >
          <table className="bf-table bf-table--dense econ-means">
            <caption className="sr-only">Baseline and Reflex means per execution</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Figure</span>
                </th>
                <th scope="col" className="bf-table__cell--end">
                  Baseline <Provenance kind={baseline.provenance} metric="tokens_per_task" />
                </th>
                <th scope="col" className="bf-table__cell--end">
                  Reflex <Provenance kind={reuse.provenance} metric="tokens_per_task" />
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">Runs averaged</th>
                <td className="bf-table__cell--end mono num">{formatCount(baseline.samples)}</td>
                <td className="bf-table__cell--end mono num">
                  {formatCount(reuse.shadowExecutions + reuse.liveExecutions)}
                </td>
              </tr>
              <tr>
                <th scope="row">Model calls</th>
                <td className="bf-table__cell--end mono num">{baseline.meanModelCalls}</td>
                <td className="bf-table__cell--end mono num">{reuse.meanModelCalls}</td>
              </tr>
              <tr>
                <th scope="row">Tokens</th>
                <td className="bf-table__cell--end mono num">
                  {formatTokens(baseline.meanTokens)}
                </td>
                <td className="bf-table__cell--end mono num">{formatTokens(reuse.meanTokens)}</td>
              </tr>
              <tr>
                <th scope="row">Cost</th>
                <td className="bf-table__cell--end mono num">
                  {formatUsd(baseline.meanCostUsd, { digits: 4 })}
                </td>
                <td className="bf-table__cell--end mono num">
                  {formatUsd(reuse.meanCostUsd, { digits: 5 })}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <p className="econ-note">
          <span>
            A Reflex run averages {reuse.meanModelCalls} model calls: a call happens only where a
            step crosses its uncertainty boundary, and here it is a deterministic-provider
            (synthetic) call.
            {derived.meansGap.differs
              ? ` The saving is not simply ${formatTokens(derived.meansGap.differenceOfMeans)}, the difference of these means: it is measured against the baseline run on the very same task.`
              : ''}
          </span>
        </p>
      </Panel>
    </div>
  );
}

/** CRR beside the verification pass rate: reusing the wrong thing confidently would also score high. */
export function CrrPanel({ report }: { report: EconomicsReport }) {
  const { crr } = report;
  return (
    <div className="econ-cell">
      <Panel
        title="Cognitive Reuse Ratio, beside verification"
        subtitle="Share of the workflow done by validated local steps, weighted by what the baseline spent on them."
      >
        <div className="econ-crr">
          <div className="econ-crr__item" data-testid="econ-crr">
            {crr.value === null ? (
              <EmptyState
                compact
                title="No CRR yet"
                description="It needs a Reflex run to measure."
              />
            ) : (
              <Gauge
                value={crr.value}
                label="Cognitive Reuse Ratio"
                valueText={formatPct(crr.value, { digits: 1 })}
                caption="CRR"
                tone="steel"
                size={170}
              />
            )}
            <p className="econ-crr__label">
              CRR over {plural(crr.runs, 'run')} <Provenance kind={crr.provenance} metric="crr" />
            </p>
          </div>
          <div className="econ-crr__item" data-testid="econ-verification-rate">
            {crr.verificationPassRate === null ? (
              <EmptyState
                compact
                title="No verification yet"
                description="It needs a verified Reflex run."
              />
            ) : (
              <Gauge
                value={crr.verificationPassRate}
                label="Verification pass rate"
                valueText={formatPct(crr.verificationPassRate, { digits: 1 })}
                caption="VERIFIED"
                tone="jade"
                size={170}
              />
            )}
            <p className="econ-crr__label">
              Verification pass rate{' '}
              <Provenance kind={report.reuse.provenance} metric="shadow_agreement" />
            </p>
          </div>
        </div>
        <p className="econ-note">
          <span>
            CRR is a proposed BigForge metric, not an industry standard. It is only meaningful
            beside verification: reusing the wrong thing confidently yields a high CRR and a bad
            outcome. {crr.note}
          </span>
        </p>
      </Panel>
    </div>
  );
}

/** Realized (what ran) beside projected (an extrapolation), with the assumption stated. */
export function LedgerPanel({ report, derived }: { report: EconomicsReport; derived: Derived }) {
  const { realized, projected, reuse } = report;
  const interval = formatRoiRange(projected.roiInterval);
  const rows: { label: string; realized: string; projected: string }[] = [
    {
      label: 'Executions',
      realized:
        reuse.liveExecutions === 0
          ? 'none live yet'
          : plural(reuse.liveExecutions, 'live execution'),
      projected: `${formatCount(projected.executions)} assumed`,
    },
    {
      label: 'Tokens avoided',
      realized: formatTokens(realized.avoidedTokens),
      projected: formatTokens(projected.avoidedTokens),
    },
    {
      label: 'Net tokens (avoided minus investment)',
      realized: formatTokens(realized.netTokens),
      projected: formatTokens(projected.netTokens),
    },
    {
      label: 'Net dollars (with review)',
      realized: formatUsd(realized.netCostUsd),
      projected: formatUsd(projected.netCostUsd),
    },
    {
      label: 'Token ROI',
      realized: formatRoi(derived.tokens.realizedRoi).text,
      projected: `${formatRoi(projected.roi).text}${interval ? ` (${interval})` : ''}`,
    },
    {
      label: 'Break-even',
      realized:
        reuse.liveExecutions === 0
          ? 'no live execution'
          : realized.netTokens >= 0
            ? 'reached'
            : 'not reached yet',
      projected:
        derived.tokens.breakEven === null
          ? 'none'
          : `after ${plural(derived.tokens.breakEven, 'execution')}`,
    },
  ];
  return (
    <div className="econ-cell">
      <Panel
        title="Realized and projected"
        subtitle="What happened, beside what an assumption extrapolates."
      >
        <div
          className="bf-table-wrap"
          role="region"
          aria-label="Realized and projected economics"
          tabIndex={0}
        >
          <table className="bf-table bf-table--dense econ-ledger-table">
            <caption className="sr-only">Realized and projected economics</caption>
            <thead>
              <tr>
                <th scope="col">
                  <span className="sr-only">Figure</span>
                </th>
                <th scope="col" className="bf-table__cell--end">
                  Realized <Provenance kind={realizedProvenance(report)} metric="cognitive_roi" />
                </th>
                <th scope="col" className="bf-table__cell--end">
                  Projected <Provenance kind={projected.provenance} metric="cognitive_roi" />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.label}>
                  <th scope="row">{row.label}</th>
                  <td className="bf-table__cell--end mono num">{row.realized}</td>
                  <td className="bf-table__cell--end mono num">{row.projected}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="econ-note">
          <span>{projected.assumption}</span>
        </p>
        <span className="sr-only">{`Provenance of projected token figures: ${tokenProvenance(report).join(', ')}`}</span>
      </Panel>
    </div>
  );
}
