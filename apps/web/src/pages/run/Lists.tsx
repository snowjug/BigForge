import type { RunSummaryDto, ScenarioDto } from '@bigforge/schemas';
import { Link } from 'react-router';
import { useDemoTarget } from '../../demo/useDemo';
import { useNow } from '../../hooks/useNow';
import { runPath } from '../../routes';
import {
  Chip,
  EmptyState,
  ErrorState,
  Panel,
  Skeleton,
  VerificationChip,
  cx,
  formatTokens,
  relativeTime,
} from '../../ui';
import { useRecentLiveRuns } from './hooks';
import { KIND_LABEL, isReflexKind } from './selectors';

const STATUS_TONE: Record<string, 'jade' | 'crimson' | 'amber' | 'ash'> = {
  success: 'jade',
  failed: 'crimson',
  stopped: 'amber',
  fallback: 'amber',
};

export function RunStrip({
  runs,
  selectedId,
  onSelect,
}: {
  runs: readonly RunSummaryDto[];
  selectedId: string | null;
  onSelect: (runId: string) => void;
}) {
  if (runs.length === 0) return null;
  return (
    <div className="run-strip" role="group" aria-label="Runs of this task">
      <span className="micro">Runs of this task</span>
      <ul className="run-strip__list">
        {runs.map((run) => (
          <li key={run.id}>
            <button
              type="button"
              className={cx('run-strip__btn', run.id === selectedId && 'is-selected')}
              aria-pressed={run.id === selectedId}
              onClick={() => {
                onSelect(run.id);
              }}
              title={run.id}
            >
              <span
                className="run-strip__kind"
                data-reflex={isReflexKind(run.kind) ? 'true' : 'false'}
              >
                {KIND_LABEL[run.kind]}
              </span>
              <span className="run-strip__status" data-tone={STATUS_TONE[run.status] ?? 'ash'}>
                {run.status}
              </span>
              <span className="num run-strip__tok">{formatTokens(run.usage.totalTokens)} tok</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function RecentRuns({
  scenarios,
  currentRunId,
}: {
  scenarios: readonly ScenarioDto[] | undefined;
  currentRunId: string | null;
}) {
  const target = useDemoTarget('variations');
  const { runs, loading, error } = useRecentLiveRuns(8);
  const now = useNow();
  const byTask = new Map(
    (scenarios ?? [])
      .filter((scenario) => scenario.taskId)
      .map((scenario) => [scenario.taskId as string, scenario]),
  );

  return (
    <section className="run-region" aria-labelledby="run-recent-title" {...target}>
      <Panel
        title={<span id="run-recent-title">Recent runs</span>}
        subtitle="The latest baseline and Reflex runs across all tasks, newest first"
        variant="flush"
      >
        {error ? (
          <ErrorState compact title="Could not load recent runs" error={error} />
        ) : loading ? (
          <div className="run-recent__skeleton" aria-busy="true" aria-label="Loading recent runs">
            {Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} height={34} radius={6} />
            ))}
          </div>
        ) : runs.length === 0 ? (
          <EmptyState
            compact
            title="No runs yet"
            description="Send a failure and run the baseline agent. Its run appears here."
          />
        ) : (
          <ol className="run-recent" data-testid="recent-runs">
            {runs.map((run) => {
              const scenario = byTask.get(run.taskId);
              return (
                <li key={run.id} data-current={run.id === currentRunId ? 'true' : undefined}>
                  <span className="run-recent__when faint" title={run.createdAt}>
                    {relativeTime(run.createdAt, now)}
                  </span>
                  <Chip tone="ash" variant="outline" size="sm" mono>
                    {scenario?.id ?? run.taskId.slice(-6)}
                  </Chip>
                  <Chip
                    tone={isReflexKind(run.kind) ? 'steel' : 'ember'}
                    variant="outline"
                    size="sm"
                  >
                    {KIND_LABEL[run.kind]}
                  </Chip>
                  <Chip tone={STATUS_TONE[run.status] ?? 'ash'} variant="soft" size="sm">
                    {run.status}
                  </Chip>
                  <VerificationChip status={run.verification} />
                  <span className="num run-recent__tok">
                    {formatTokens(run.usage.totalTokens)}{' '}
                    <span className="faint">tokens, synthetic</span>
                  </span>
                  <Link
                    className="run-recent__open"
                    to={runPath({ task: run.taskId, run: run.id })}
                  >
                    Open
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </Panel>
    </section>
  );
}
