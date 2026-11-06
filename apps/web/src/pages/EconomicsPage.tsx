import { useState } from 'react';
import { useEconomics } from '../api/hooks';
import { ErrorState, Page, PageHeader, Spinner } from '../ui';
import { AssumptionsPanel } from './economics/AssumptionsPanel';
import { BreakEvenPanel } from './economics/BreakEvenPanel';
import { EconomicsSkeleton } from './economics/EconomicsSkeleton';
import { CrrPanel, InvestmentPanel, LedgerPanel, SavingPanel } from './economics/EvidencePanels';
import { deriveEconomics, describeVerdict, missingEvidence } from './economics/model';
import { RoiPair } from './economics/RoiPair';
import { assumptionParams, useDebouncedValue } from './economics/useAssumptions';
import { EarlyState, VerdictBlock } from './economics/VerdictBlock';
import { PAGE_META } from './pageMeta';
import '../styles/economics.css';

const META = PAGE_META.economics;

/**
 * Is it worth it? The verdict in words, the two ROIs side by side (tokens and dollars), the break-even
 * chart with its interval, the investment ledger and the assumptions that drive them. Every figure comes
 * from `GET /api/economics`; exploring assumptions changes the query, never saved settings.
 */
export default function EconomicsPage() {
  const [executions, setExecutions] = useState<number | null>(null);
  const [conservative, setConservative] = useState<boolean | null>(null);
  const settled = useDebouncedValue(executions, 350);
  const query = useEconomics(assumptionParams(settled, conservative));
  const report = query.data;

  const header = (
    <PageHeader
      eyebrow="Measure"
      title={META.title}
      question={META.question}
      meta={
        <span>
          Decision: {META.decision} &middot; Evidence: {META.evidence} &middot; Action:{' '}
          {META.action}
        </span>
      }
    />
  );

  if (query.isPending) {
    return (
      <Page title={META.title}>
        {header}
        <EconomicsSkeleton />
      </Page>
    );
  }
  if (!report) {
    return (
      <Page title={META.title}>
        {header}
        <ErrorState
          title="The economics report could not be loaded"
          error={query.error}
          retrying={query.isFetching}
          onRetry={() => {
            void query.refetch();
          }}
        />
      </Page>
    );
  }

  const derived = deriveEconomics(report);
  const verdict = describeVerdict(report, derived);
  const learning = report.investment.lines.find((line) => line.id === 'learning');
  const shownExecutions = executions ?? report.projected.executions;
  const shownConservative = conservative ?? Boolean(learning?.counted);
  const recomputing =
    executions !== settled || (query.isFetching && report.projected.executions !== shownExecutions);

  const assumptions = (
    <AssumptionsPanel
      report={report}
      executions={shownExecutions}
      onExecutions={setExecutions}
      conservative={shownConservative}
      onConservative={setConservative}
      recomputing={recomputing}
      changed={executions !== null || conservative !== null}
      onReset={() => {
        setExecutions(null);
        setConservative(null);
      }}
    />
  );

  return (
    <Page title={META.title}>
      {header}
      {query.isError ? (
        <ErrorState
          compact
          title="The latest figures could not be refreshed. Showing the last ones."
          error={query.error}
          retrying={query.isFetching}
          onRetry={() => {
            void query.refetch();
          }}
        />
      ) : null}
      <div className="econ" aria-busy={recomputing}>
        {derived.empty ? (
          <div className="econ-grid econ-grid--early">
            <EarlyState missing={missingEvidence(report)} />
            {assumptions}
          </div>
        ) : (
          <>
            <VerdictBlock report={report} derived={derived} verdict={verdict} />
            <RoiPair report={report} derived={derived} />
            <div className="econ-grid">
              <BreakEvenPanel report={report} />
              {assumptions}
            </div>
            <div className="econ-grid econ-grid--even">
              <InvestmentPanel report={report} />
              <SavingPanel report={report} derived={derived} />
            </div>
            <div className="econ-grid econ-grid--even">
              <CrrPanel report={report} />
              <LedgerPanel report={report} derived={derived} />
            </div>
          </>
        )}
        {recomputing ? (
          <p className="econ-busy" role="status" aria-live="polite">
            <Spinner size={14} /> Recomputing for {shownExecutions.toLocaleString('en-US')}{' '}
            executions
          </p>
        ) : null}
      </div>
    </Page>
  );
}
