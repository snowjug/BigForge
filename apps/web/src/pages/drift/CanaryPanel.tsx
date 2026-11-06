import { Check, Play, X } from 'lucide-react';
import { useState } from 'react';
import type {
  ComparisonDto,
  DriftCheckDto,
  DriftViewDto,
  JobDto,
  ReflexStatus,
} from '@bigforge/schemas';
import { errorMessage } from '../../api/client';
import { useStartCanary, useSystem } from '../../api/hooks';
import { useDemoTarget } from '../../demo/useDemo';
import {
  Button,
  Chip,
  DataTable,
  EmptyState,
  Metric,
  Provenance,
  formatPct,
  formatTimestamp,
  formatTokens,
  formatUsd,
  plural,
} from '../../ui';
import {
  DRIFT_STATUS_TEXT,
  type CanaryRow,
  agreementCounts,
  canaryBlocker,
  canaryRows,
  describeStopReason,
  divergenceHistogram,
  driftStatus,
} from './model';
import { JobLine, StageHead } from './parts';
import { useDemoJob, useJobFollower } from './useDriftWorkspace';
import { useAuth } from '../../auth/useAuth';

interface CanaryPanelProps {
  versionId: string | null;
  status: ReflexStatus | null;
  check: DriftCheckDto | null;
  config: DriftViewDto['config'];
  comparisons: readonly ComparisonDto[];
  /** What the server says the caller may do for this version (preferred over deriving permissions). */
  serverAllowsCanary: boolean | null;
}

function ResultChip({ agree }: { agree: boolean }) {
  return agree ? (
    <Chip tone="jade" size="sm" icon={<Check size={12} strokeWidth={2.75} />}>
      Agree
    </Chip>
  ) : (
    <Chip tone="crimson" size="sm" icon={<X size={12} strokeWidth={2.75} />}>
      Disagree
    </Chip>
  );
}

function VerdictBlock({ check, config }: { check: DriftCheckDto; config: DriftViewDto['config'] }) {
  const { verdict } = check;
  const status = driftStatus(verdict, config);
  const text = DRIFT_STATUS_TEXT[status];
  return (
    <div
      className="drift-verdict"
      data-testid="drift-verdict"
      data-status={status}
      data-tone={text.tone}
    >
      <div className="drift-verdict__head">
        <Chip tone={text.tone} variant="solid" className="drift-verdict__chip">
          {text.headline}
        </Chip>
        <span className="dim">
          canary on forge-ci {check.envVersion} &middot; {plural(verdict.samples, 'sample')} (at
          least {config.minSamples} needed)
        </span>
        <Provenance kind={check.detail.canaryCost.provenance} metric="shadow_agreement" />
      </div>
      <p className="drift-verdict__reason">{verdict.reasons[0] ?? ''}</p>
      <dl className="drift-verdict__facts">
        <div>
          <dt>Historic agreement</dt>
          <dd className="num">{formatPct(verdict.historicAgreement, { digits: 0 })}</dd>
          <dd className="dim">shadow runs</dd>
        </div>
        <div>
          <dt>Canary agreement</dt>
          <dd className="num" data-tone={verdict.drift ? 'crimson' : 'jade'}>
            {formatPct(verdict.currentAgreement, { digits: 0 })}
          </dd>
          <dd className="dim">floor {formatPct(config.floor, { digits: 0 })}</dd>
        </div>
        <div>
          <dt>Drop</dt>
          <dd className="num">{`${(verdict.drop * 100).toFixed(0)} points`}</dd>
          <dd className="dim">drift at {(config.dropThreshold * 100).toFixed(0)} or more</dd>
        </div>
        <div>
          <dt>90% interval</dt>
          <dd className="num">
            {formatPct(verdict.interval.low, { digits: 0 })} to{' '}
            {formatPct(verdict.interval.high, { digits: 0 })}
          </dd>
          <dd className="dim">of canary agreement</dd>
        </div>
      </dl>
    </div>
  );
}

function Tape({ rows }: { rows: readonly CanaryRow[] }) {
  return (
    <ul className="drift-tape" aria-hidden="true">
      {rows.map((row) => (
        <li
          key={row.id}
          data-agree={row.agree}
          title={`${row.scenarioId}: ${row.agree ? 'agrees' : 'disagrees'}`}
        >
          {row.agree ? <Check size={12} strokeWidth={2.5} /> : <X size={12} strokeWidth={2.5} />}
        </li>
      ))}
    </ul>
  );
}

function RowDetail({ row, comparison }: { row: CanaryRow; comparison: ComparisonDto | undefined }) {
  return (
    <div className="drift-rowdetail" aria-live="polite">
      <p className="drift-rowdetail__title">
        <span className="mono">{row.scenarioId}</span> {row.fault} in {row.workspace}
        <ResultChip agree={row.agree} />
      </p>
      {comparison ? (
        <>
          {comparison.comparison.divergence.kind !== 'none' ? (
            <p className="drift-rowdetail__why">{comparison.comparison.divergence.detail}</p>
          ) : (
            <p className="drift-rowdetail__why">
              Same outcome, same root cause, same files, verified by both.
            </p>
          )}
          <ul className="drift-checks">
            {comparison.comparison.checks.map((check) => (
              <li key={check.id} data-match={check.match}>
                <span className="drift-checks__mark" aria-hidden="true">
                  {check.match ? (
                    <Check size={12} strokeWidth={2.5} />
                  ) : (
                    <X size={12} strokeWidth={2.5} />
                  )}
                </span>
                <span className="drift-checks__label">{check.label}</span>
                <span className="drift-checks__pair">
                  <span className="faint">baseline</span> {check.baseline}
                  <span className="faint"> &middot; Reflex</span> {check.reflex}
                  <span className="sr-only">{check.match ? ' (match)' : ' (differs)'}</span>
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="faint">{describeStopReason(row.stopReason, row.reflexStatus)}</p>
      )}
    </div>
  );
}

/** Familiar tasks through both the Reflex and the baseline in the current world; where they disagree, the world changed. */
export function CanaryPanel({
  versionId,
  status,
  check,
  config,
  comparisons,
  serverAllowsCanary,
}: CanaryPanelProps) {
  const target = useDemoTarget('canary');
  const auth = useAuth();
  const start = useStartCanary();
  const system = useSystem();
  const pricing = system.data?.pricing ?? null;
  const follower = useJobFollower();
  const demoJob = useDemoJob('canary');
  const [startError, setStartError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const blocker =
    canaryBlocker({ hasVersion: versionId !== null, canRun: auth.can('canary'), status }) ??
    (serverAllowsCanary === false
      ? 'The server does not allow the canary for this Reflex right now.'
      : null);
  const running = start.isPending || follower.running || demoJob !== null;
  const progress: Pick<JobDto, 'progress' | 'status'> | null = demoJob ?? follower.job;

  const rows = check ? canaryRows(check) : [];
  const counts = check ? agreementCounts(check) : null;
  const histogram = check ? divergenceHistogram(check) : [];
  const selectedRow =
    rows.find((row) => row.id === selected) ?? rows.find((row) => !row.agree) ?? null;
  const selectedComparison = comparisons.find((item) => item.id === selectedRow?.comparisonId);
  const verdictStatus = check ? driftStatus(check.verdict, config) : 'none';

  const run = () => {
    if (!versionId) return;
    setStartError(null);
    start.mutate(versionId, {
      onSuccess: (envelope) => {
        follower.follow(envelope.job.id);
      },
      onError: (error) => {
        setStartError(errorMessage(error));
      },
    });
  };

  return (
    <section
      className="drift-stage"
      id="drift-canary"
      aria-labelledby="drift-canary-title"
      {...target}
    >
      <StageHead
        n={2}
        id="drift-canary-title"
        title="The Drift Canary"
        lede="Familiar tasks go through both the Reflex and the baseline again. Where they disagree is where the world changed."
        state={
          check
            ? {
                label: DRIFT_STATUS_TEXT[verdictStatus].headline.toLowerCase(),
                tone: DRIFT_STATUS_TEXT[verdictStatus].tone,
              }
            : { label: 'not run yet', tone: 'ash' }
        }
        actions={
          <Button
            variant="forge"
            icon={<Play size={14} />}
            data-testid="drift-run-canary"
            loading={running}
            disabled={blocker !== null}
            {...(blocker ? { disabledReason: blocker } : {})}
            onClick={run}
          >
            {check ? 'Run the Drift Canary again' : 'Run the Drift Canary'}
          </Button>
        }
      />
      <JobLine job={running ? progress : null} />
      {(follower.failure ?? startError) ? (
        <p className="drift-error" role="alert">
          The canary did not finish: {follower.failure ?? startError}
        </p>
      ) : null}

      {check && counts ? (
        <>
          <VerdictBlock check={check} config={config} />
          <div className="drift-canary" data-testid="canary-grid">
            <div className="drift-canary__main">
              <div className="drift-canary__summary">
                <Tape rows={rows} />
                <p>
                  <strong className="num">
                    {counts.agree} of {counts.total}
                  </strong>{' '}
                  familiar tasks agree.{' '}
                  {counts.disagree > 0 ? `${counts.disagree} disagree.` : 'None disagree.'}{' '}
                  <span className="faint">Sample: {check.detail.sample} tasks.</span>
                </p>
              </div>
              <DataTable<CanaryRow>
                caption="Drift Canary results per task"
                rows={rows}
                getRowId={(row) => row.id}
                selectedId={selectedRow?.id ?? null}
                onSelect={(row) => {
                  setSelected(row.id);
                }}
                dense
                maxHeight={420}
                rowTone={(row) => (row.agree ? undefined : 'crimson')}
                columns={[
                  {
                    id: 'task',
                    header: 'Task',
                    width: '40%',
                    cell: (row) => (
                      <span className="drift-task">
                        <span className="mono">{row.scenarioId}</span>{' '}
                        <span className="drift-task__variant">
                          {row.fault} <span className="faint">in {row.workspace}</span>
                        </span>
                      </span>
                    ),
                  },
                  {
                    id: 'result',
                    header: 'Result',
                    cell: (row) => <ResultChip agree={row.agree} />,
                  },
                  {
                    id: 'step',
                    header: 'First divergence',
                    cell: (row) => row.divergenceStep ?? '\u2014',
                    mono: true,
                  },
                  {
                    id: 'ended',
                    header: 'Reflex ended',
                    cell: (row) => describeStopReason(row.stopReason, row.reflexStatus),
                    hideOnMobile: true,
                  },
                ]}
              />
              {selectedRow ? <RowDetail row={selectedRow} comparison={selectedComparison} /> : null}
            </div>
            <aside className="drift-canary__side" aria-label="Divergence by step and canary cost">
              <div>
                <p className="micro">Where trust cracked: first divergence by step</p>
                {histogram.length === 0 ? (
                  <p className="drift-canary__none">No task diverged.</p>
                ) : (
                  <ul className="drift-hist">
                    {histogram.map((bar) => (
                      <li key={bar.stepId ?? 'none'}>
                        <span className="mono drift-hist__step">
                          {bar.stepId ?? 'unknown step'}
                        </span>
                        <span className="drift-hist__track" aria-hidden="true">
                          <span style={{ width: `${Math.max(4, bar.share * 100)}%` }} />
                        </span>
                        <span className="num drift-hist__count">
                          {bar.count} of {check.detail.sample}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <Metric
                label="Canary cost"
                value={formatTokens(check.detail.canaryCost.tokens)}
                unit="tokens"
                provenance={check.detail.canaryCost.provenance}
                definition="tokens_per_task"
                size="md"
                hint={
                  <>
                    {formatUsd(check.detail.canaryCost.costUsd)}
                    {pricing
                      ? ` at price sheet ${pricing.id}, an assumption dated ${formatTimestamp(pricing.assumedAt).slice(0, 10)}`
                      : ' on the assumed demo price sheet'}
                    . The price of vigilance: baseline reference runs.
                  </>
                }
              />
            </aside>
          </div>
        </>
      ) : (
        <EmptyState
          title={
            status === null
              ? 'There is no Reflex to monitor yet'
              : status === 'active' || status === 'watch'
                ? 'No drift check yet'
                : 'This Reflex is not active, so there is nothing to monitor'
          }
          description={
            status === null
              ? 'Drift watches a Reflex. Learn and promote one first (demo steps 5 to 11).'
              : status === 'active' || status === 'watch'
                ? 'Run the Drift Canary to compare the Reflex with the baseline in the current environment.'
                : 'The canary monitors active Reflexes. A reviewer promotes a Reflex once replay and Shadow Brain agree (demo step 11).'
          }
          compact
        />
      )}
    </section>
  );
}
