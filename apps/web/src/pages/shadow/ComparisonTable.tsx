import type { ComparisonDto } from '@bigforge/schemas';
import { CircleCheck, CircleX, ExternalLink } from 'lucide-react';
import { type ReactNode, useState } from 'react';
import { tracePath } from '../../routes';
import {
  Button,
  ButtonLink,
  type Column,
  DataTable,
  Drawer,
  EmptyState,
  Provenance,
  formatCount,
  formatMs,
  formatUsd,
  plural,
} from '../../ui';
import { byScenario, divergenceText, failedChecks } from './compare';

function Verdict({ agree }: { agree: boolean }) {
  return (
    <span className="shd-verdict" data-agree={agree}>
      {agree ? (
        <CircleCheck size={15} aria-hidden="true" />
      ) : (
        <CircleX size={15} aria-hidden="true" />
      )}
      {agree ? 'Agree' : 'Disagree'}
    </span>
  );
}

function Pair({ from, to }: { from: string; to: string }) {
  return (
    <span className="shd-pair mono num">
      <span className="shd-pair__from">{from}</span>
      <span aria-hidden="true" className="shd-pair__arrow">
        {'\u2192'}
      </span>
      <span className="sr-only"> to </span>
      <strong>{to}</strong>
    </span>
  );
}

const columns: Column<ComparisonDto>[] = [
  {
    id: 'scenario',
    header: 'Task',
    cell: (c) => (
      <div className="shd-task">
        <span className="mono shd-task__id">{c.scenarioId}</span>
        <span className="shd-task__title dim">{c.taskTitle}</span>
      </div>
    ),
  },
  {
    id: 'variant',
    header: 'Variant',
    mono: true,
    hideOnMobile: true,
    cell: (c) => <span className="shd-variant">{c.variantKey}</span>,
  },
  { id: 'agree', header: 'Agreement', cell: (c) => <Verdict agree={c.agree} /> },
  {
    id: 'tokens',
    header: 'Tokens (synthetic)',
    align: 'end',
    cell: (c) => <Pair from={formatCount(c.baseline.tokens)} to={formatCount(c.reflex.tokens)} />,
  },
  {
    id: 'calls',
    header: 'Model calls (synthetic)',
    align: 'end',
    hideOnMobile: true,
    cell: (c) => <Pair from={String(c.baseline.calls)} to={String(c.reflex.calls)} />,
  },
  {
    id: 'cost',
    header: 'Cost (synthetic)',
    align: 'end',
    hideOnMobile: true,
    cell: (c) => <Pair from={formatUsd(c.baseline.costUsd)} to={formatUsd(c.reflex.costUsd)} />,
  },
  {
    id: 'commands',
    header: 'Commands (measured)',
    align: 'end',
    hideOnMobile: true,
    cell: (c) => <Pair from={String(c.baseline.commands)} to={String(c.reflex.commands)} />,
  },
  {
    id: 'time',
    header: 'Time (simulated → measured)',
    align: 'end',
    hideOnMobile: true,
    cell: (c) => (
      <Pair from={formatMs(c.baseline.modelLatencyMs)} to={formatMs(c.reflex.localMs)} />
    ),
  },
  {
    id: 'divergence',
    header: 'Divergence',
    hideOnMobile: true,
    cell: (c) => (
      <span className={c.agree ? 'faint' : undefined}>
        {c.agree ? '\u2014' : divergenceText(c)}
      </span>
    ),
  },
];

interface DetailProps {
  item: ComparisonDto;
}

function MetricRow({
  label,
  baseline,
  reflex,
  basis,
}: {
  label: string;
  baseline: string;
  reflex: string;
  basis: Parameters<typeof Provenance>[0]['kind'];
}) {
  return (
    <tr>
      <th scope="row">{label}</th>
      <td className="shd-end mono num">{baseline}</td>
      <td className="shd-end mono num">{reflex}</td>
      <td>
        <Provenance kind={basis} />
      </td>
    </tr>
  );
}

function ComparisonDetail({ item }: DetailProps) {
  const { comparison } = item;
  const failed = failedChecks(item);
  return (
    <div className="shd-detail">
      <div className="shd-detail__top">
        <Verdict agree={item.agree} />
        <span className="faint mono">{item.kind}</span>
      </div>
      <p className="dim">{item.taskTitle}</p>
      <p className="mono faint shd-variant">{item.variantKey}</p>

      <section aria-label="Checks">
        <h3 className="shd-h3">Checks</h3>
        <div className="shd-table-wrap" tabIndex={0} role="region" aria-label="Agreement checks">
          <table className="shd-table">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">Baseline</th>
                <th scope="col">Reflex</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {comparison.checks.map((check) => (
                <tr key={check.id}>
                  <th scope="row">{check.label}</th>
                  <td className="mono">{check.baseline}</td>
                  <td className="mono">{check.reflex}</td>
                  <td>
                    <span className="shd-verdict" data-agree={check.match}>
                      {check.match ? (
                        <CircleCheck size={14} aria-hidden="true" />
                      ) : (
                        <CircleX size={14} aria-hidden="true" />
                      )}
                      {check.match ? 'Match' : 'Differs'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="shd-note">
          {item.agree
            ? 'Two executions agree when they reach the same outcome, both verify independently, find the same root cause and leave the same final files, and the Reflex makes no blocked or unsafe action.'
            : `Disagreement on: ${failed.join(', ')}. ${divergenceText(item)}.`}
        </p>
      </section>

      <section aria-label="Figures">
        <h3 className="shd-h3">Baseline agent against Reflex</h3>
        <div className="shd-table-wrap" tabIndex={0} role="region" aria-label="Figures per side">
          <table className="shd-table">
            <thead>
              <tr>
                <th scope="col">Figure</th>
                <th scope="col" className="shd-end">
                  Baseline
                </th>
                <th scope="col" className="shd-end">
                  Reflex
                </th>
                <th scope="col">Basis</th>
              </tr>
            </thead>
            <tbody>
              <MetricRow
                label="Tokens"
                baseline={formatCount(item.baseline.tokens)}
                reflex={formatCount(item.reflex.tokens)}
                basis="synthetic"
              />
              <MetricRow
                label="Model calls"
                baseline={String(item.baseline.calls)}
                reflex={String(item.reflex.calls)}
                basis="synthetic"
              />
              <MetricRow
                label="Cost"
                baseline={formatUsd(item.baseline.costUsd)}
                reflex={formatUsd(item.reflex.costUsd)}
                basis="synthetic"
              />
              <MetricRow
                label="Commands"
                baseline={String(item.baseline.commands)}
                reflex={String(item.reflex.commands)}
                basis="measured"
              />
              <MetricRow
                label="Model latency"
                baseline={formatMs(item.baseline.modelLatencyMs)}
                reflex={formatMs(item.reflex.modelLatencyMs)}
                basis="simulated"
              />
              <MetricRow
                label="Local time"
                baseline={formatMs(item.baseline.localMs)}
                reflex={formatMs(item.reflex.localMs)}
                basis="measured"
              />
            </tbody>
          </table>
        </div>
        <p className="shd-note">
          Run status: baseline {item.baseline.status}, Reflex {item.reflex.status}. Pricing is an
          assumption (synthetic demo price sheet), not a vendor price.
        </p>
      </section>

      <section aria-label="Traces" className="shd-detail__links">
        <h3 className="shd-h3">Traces of both runs</h3>
        <div className="cluster">
          {item.baselineRunId ? (
            <ButtonLink
              to={tracePath(item.baselineRunId)}
              size="sm"
              iconRight={<ExternalLink size={13} />}
            >
              Baseline trace
            </ButtonLink>
          ) : (
            <span className="faint">No baseline run recorded.</span>
          )}
          <ButtonLink
            to={tracePath(item.reflexRunId)}
            size="sm"
            iconRight={<ExternalLink size={13} />}
          >
            Reflex trace
          </ButtonLink>
        </div>
      </section>
    </div>
  );
}

interface Props {
  rows: readonly ComparisonDto[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  caption: string;
  empty: ReactNode;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
  total?: number;
  maxHeight?: string;
}

/** One row per comparison, sorted by task. Selecting a row opens a drawer with every check and both traces. */
export function ComparisonTable({
  rows,
  loading,
  error,
  onRetry,
  caption,
  empty,
  hasMore,
  loadingMore,
  onLoadMore,
  total,
  maxHeight = 'min(70dvh, 640px)',
}: Props) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const sorted = rows ? byScenario(rows) : undefined;
  const selected = sorted?.find((r) => r.id === selectedId) ?? null;

  return (
    <>
      <DataTable
        caption={caption}
        columns={columns}
        rows={sorted}
        getRowId={(c) => c.id}
        loading={loading}
        error={error}
        onRetry={onRetry}
        selectedId={selectedId}
        onSelect={(row) => {
          setSelectedId(row.id);
        }}
        rowTone={(c) => (c.agree ? undefined : 'crimson')}
        dense
        maxHeight={maxHeight}
        skeletonRows={6}
        empty={empty ?? <EmptyState compact title="No comparisons yet" />}
        footer={
          sorted && sorted.length > 0 ? (
            <>
              <span className="num">
                Showing {plural(sorted.length, 'comparison')}
                {total !== undefined && total > sorted.length ? ` of ${total}` : ''}. Select a row
                for every check and both traces.
              </span>
              {hasMore ? (
                <Button size="sm" loading={loadingMore ?? false} onClick={onLoadMore}>
                  Load more
                </Button>
              ) : null}
            </>
          ) : undefined
        }
      />
      <Drawer
        open={selected !== null}
        onClose={() => {
          setSelectedId(null);
        }}
        title={selected ? `${selected.scenarioId} · ${selected.agree ? 'Agree' : 'Disagree'}` : ''}
        description={
          selected ? `${selected.kind} comparison of the baseline agent and the Reflex` : undefined
        }
        modal={false}
        width={520}
      >
        {selected ? <ComparisonDetail item={selected} /> : null}
      </Drawer>
    </>
  );
}
