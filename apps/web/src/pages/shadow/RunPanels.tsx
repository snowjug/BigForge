import type { ComparisonDto, JobDto, ReflexVersionDto } from '@bigforge/schemas';
import { CircleCheck, CircleX, Eye, Play } from 'lucide-react';
import { useDemoTarget } from '../../demo/useDemo';
import { Button, Meter, Provenance, formatCount, formatPct, plural } from '../../ui';
import type { ActionState } from '../reflexes/actions';
import { aggregateComparisons, totalBaselineTokens } from './compare';

interface ReplayProps {
  version: ReflexVersionDto;
  state: ActionState;
  pending: boolean;
  onRun: () => void;
  rows: readonly ComparisonDto[] | undefined;
  /** Opens the full per-trace comparison table. */
  onShowResults: () => void;
}

/** Replay: re-run the recorded tasks the Reflex was compiled from and compare each with what the baseline did. */
export function ReplayPanel({ version, state, pending, onRun, rows, onShowResults }: ReplayProps) {
  const target = useDemoTarget('replay');
  const total = version.spec.provenance.sourceTraceIds.length;
  const { replay } = version;
  const running = pending || version.status === 'replay';
  const done = running ? (rows?.length ?? replay.runs) : replay.runs;

  return (
    <section {...target} className="shd-panel" aria-labelledby="shd-replay-title">
      <header className="shd-panel__head">
        <div>
          <p className="micro">Step 1 · Validate</p>
          <h2 id="shd-replay-title" className="shd-h2">
            Replay the recorded tasks
          </h2>
          <p className="shd-sub">
            The candidate re-executes the {plural(total, 'task')} it was compiled from, locally and
            with no model, and each result is compared with what the baseline agent did then.
          </p>
        </div>
        <Button
          variant="forge"
          icon={<Play size={15} />}
          data-testid="replay-run"
          loading={pending}
          disabled={!state.available}
          {...(!state.available && state.reason ? { disabledReason: state.reason } : {})}
          onClick={onRun}
        >
          Replay historical traces
        </Button>
      </header>

      <div className="shd-progress" role="status" aria-live="polite" data-testid="replay-progress">
        {running ? (
          <>
            <Meter
              value={done}
              max={Math.max(total, 1)}
              label="Replay progress"
              valueText={`${done} of ${total} traces replayed`}
              tone="steel"
              showValue
            />
            <p className="shd-note">
              Replaying in the sandbox: {done} of {total} source traces done.
            </p>
          </>
        ) : replay.runs === 0 ? (
          <p className="shd-note">
            {version.status === 'candidate'
              ? 'Not run yet. Replay is the first gate: every recorded task must reproduce before Shadow Brain.'
              : 'No replay is recorded for this version.'}
          </p>
        ) : (
          <>
            <Meter
              value={replay.agreements}
              max={replay.runs}
              label="Replay agreement"
              valueText={`${replay.agreements} of ${replay.runs} traces reproduced`}
              threshold={replay.runs * version.gateConfig.minReplayAgreement}
              thresholdLabel={`Gate: ${formatPct(version.gateConfig.minReplayAgreement, { digits: 0 })} agreement`}
              tone={replay.agreements === replay.runs ? 'jade' : 'crimson'}
              showValue
            />
            <p className="shd-note num">
              <strong>
                {replay.agreements} of {replay.runs}
              </strong>{' '}
              source traces reproduced ({formatPct(replay.agreement, { digits: 0 })}), over{' '}
              {plural(replay.distinctVariants, 'variant')}. <Provenance kind="replay-measured" />
            </p>
          </>
        )}
      </div>

      {(rows?.length ?? 0) > 0 ? (
        <div>
          <ul className="shd-chips" aria-label="Replay result for each source trace">
            {[...(rows ?? [])]
              .sort((a, b) => a.scenarioId.localeCompare(b.scenarioId, 'en', { numeric: true }))
              .map((c) => (
                <li
                  key={c.id}
                  data-agree={c.agree}
                  title={`${c.scenarioId}: ${c.agree ? 'reproduced' : 'did not reproduce'} (${c.variantKey})`}
                >
                  {c.agree ? (
                    <CircleCheck size={13} aria-hidden="true" />
                  ) : (
                    <CircleX size={13} aria-hidden="true" />
                  )}
                  <span className="mono">{c.scenarioId}</span>
                  <span className="sr-only">{c.agree ? 'reproduced' : 'did not reproduce'}</span>
                </li>
              ))}
          </ul>
          <Button size="sm" variant="ghost" onClick={onShowResults}>
            Open the per-trace comparison
          </Button>
        </div>
      ) : null}
    </section>
  );
}

interface ShadowProps {
  version: ReflexVersionDto;
  state: ActionState;
  starting: boolean;
  live: boolean;
  job: JobDto | null;
  onRun: () => void;
  rows: readonly ComparisonDto[] | undefined;
}

/** Shadow Brain: the AI baseline and the candidate on held-out tasks, side by side, with live progress and counts. */
export function ShadowPanel({ version, state, starting, live, job, onRun, rows }: ShadowProps) {
  const target = useDemoTarget('shadow');
  const counts = aggregateComparisons(rows ?? []);
  const { shadow } = version;
  const tokensSpent = totalBaselineTokens(rows ?? []);
  const finished = job !== null && (job.status === 'succeeded' || job.status === 'failed');

  return (
    <section {...target} className="shd-panel" aria-labelledby="shd-shadow-title">
      <header className="shd-panel__head">
        <div>
          <p className="micro">Step 2 · Validate</p>
          <h2 id="shd-shadow-title" className="shd-h2">
            Run Shadow Brain
          </h2>
          <p className="shd-sub">
            Held-out tasks go through the AI baseline and through the candidate, side by side, on a
            throwaway copy of the synthetic lab. The Reflex never acts on anything real. Shadow runs
            spend tokens before they save any: they are booked as learning investment.
          </p>
        </div>
        <Button
          variant="forge"
          icon={<Eye size={15} />}
          data-testid="shadow-run"
          loading={starting || live}
          disabled={!state.available}
          {...(!state.available && state.reason ? { disabledReason: state.reason } : {})}
          onClick={onRun}
        >
          {live ? 'Shadow Brain running' : 'Run Shadow Brain'}
        </Button>
      </header>

      <div
        className="shd-progress"
        role="status"
        aria-live="polite"
        data-testid="shadow-progress"
        data-state={live ? 'running' : finished ? job.status : 'idle'}
      >
        {job && (live || finished) ? (
          <>
            <Meter
              value={job.progress.done}
              max={Math.max(job.progress.total, 1)}
              label="Shadow Brain progress"
              valueText={`${job.progress.done} of ${job.progress.total} scenarios`}
              tone={job.status === 'failed' ? 'crimson' : live ? 'ember' : 'jade'}
              showValue
            />
            <p className="shd-note">
              {live
                ? `Running: ${job.progress.label || 'starting'}`
                : job.status === 'succeeded'
                  ? `Finished: ${job.progress.done} of ${job.progress.total} scenarios ran.`
                  : `Failed: ${job.error ?? 'the job did not finish'}`}
            </p>
          </>
        ) : (
          <p className="shd-note">
            {shadow.runs === 0
              ? version.status === 'shadow'
                ? 'No Shadow Brain runs yet. The gate needs at least ' +
                  version.gateConfig.minShadowRuns +
                  ' runs across at least ' +
                  version.gateConfig.minDistinctVariants +
                  ' distinct variants.'
                : 'Shadow Brain runs once replay has passed and the Reflex is in Shadow.'
              : `${plural(shadow.runs, 'shadow run')} on record.`}
          </p>
        )}
        {shadow.runs > 0 || (rows?.length ?? 0) > 0 ? (
          <dl className="shd-counts">
            <div>
              <dd className="num" data-testid="shadow-count-runs">
                {counts.runs || shadow.runs}
              </dd>
              <dt>runs on record</dt>
            </div>
            <div>
              <dd className="num" data-tone="jade" data-testid="shadow-count-agree">
                {counts.runs ? counts.agreements : shadow.agreements}
              </dd>
              <dt>agree</dt>
            </div>
            <div>
              <dd
                className="num"
                data-tone={
                  (counts.runs ? counts.disagreements : shadow.runs - shadow.agreements) > 0
                    ? 'crimson'
                    : undefined
                }
                data-testid="shadow-count-disagree"
              >
                {counts.runs ? counts.disagreements : shadow.runs - shadow.agreements}
              </dd>
              <dt>disagree</dt>
            </div>
            <div>
              <dd className="num">
                {counts.runs ? counts.distinctVariants : shadow.distinctVariants}
              </dd>
              <dt>variants</dt>
            </div>
            <div>
              <dd className="num" data-tone={shadow.safetyViolations > 0 ? 'crimson' : undefined}>
                {shadow.safetyViolations}
              </dd>
              <dt>safety violations</dt>
            </div>
            <div>
              <dd className="num">{formatCount(tokensSpent)}</dd>
              <dt>
                baseline tokens spent <Provenance kind="synthetic" />
              </dt>
            </div>
          </dl>
        ) : null}
      </div>
    </section>
  );
}
