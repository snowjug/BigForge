import type { RunSummaryDto } from '@bigforge/schemas';
import { ScrollText, ShieldAlert } from 'lucide-react';
import { useMemo } from 'react';
import { Link, useNavigate } from 'react-router';
import { flattenPages, useInfiniteRuns } from '../../api/hooks';
import { useDemoTarget } from '../../demo/useDemo';
import { useNow } from '../../hooks/useNow';
import { runPath, tracePath } from '../../routes';
import {
  Button,
  ButtonLink,
  Chip,
  DataTable,
  EmptyState,
  Field,
  Page,
  PageHeader,
  Provenance,
  VerificationChip,
  formatMs,
  formatTokens,
  plural,
  relativeTime,
  type Column,
} from '../../ui';
import { KIND_LABEL, isReflexKind } from '../run/selectors';
import { TRACE_KINDS, useKindCounts, useTaskIndex, useTraceFilters } from './hooks';
import '../../styles/traces.css';

const STATUS_TONE = {
  success: 'jade',
  failed: 'crimson',
  stopped: 'amber',
  fallback: 'amber',
} as const;

export default function TracesPage() {
  const filters = useTraceFilters();
  const navigate = useNavigate();
  const now = useNow();
  const target = useDemoTarget('trace_captured');
  const taskIndex = useTaskIndex();
  const counts = useKindCounts();
  const runs = useInfiniteRuns({
    limit: 50,
    ...(filters.kind ? { kind: filters.kind } : {}),
    ...(filters.task ? { taskId: filters.task } : {}),
  });
  const rows = useMemo(() => flattenPages(runs.data), [runs.data]);
  const total = runs.data?.pages[0]?.total ?? 0;
  const filtered = filters.kind !== null || filters.task !== null;

  const columns: Column<RunSummaryDto>[] = [
    {
      id: 'time',
      header: 'Time',
      cell: (run) => (
        <span title={run.createdAt} className="trace-time">
          {relativeTime(run.createdAt, now)}
        </span>
      ),
      width: 84,
    },
    {
      id: 'kind',
      header: 'Kind',
      cell: (run) => (
        <Chip tone={isReflexKind(run.kind) ? 'steel' : 'ember'} variant="outline" size="sm">
          {KIND_LABEL[run.kind]}
        </Chip>
      ),
    },
    {
      id: 'task',
      header: 'Task',
      cell: (run) => {
        const label = taskIndex.index.get(run.taskId);
        return (
          <span className="trace-task">
            <span className="mono trace-task__id">{label?.scenarioId ?? run.taskId.slice(-6)}</span>
            <span className="trace-task__title dim">
              {label?.title ?? 'task not in the first 100'}
            </span>
          </span>
        );
      },
    },
    {
      id: 'agent',
      header: 'Agent',
      cell: (run) => (
        <span
          className="mono trace-agent"
          title={`${run.agent.name}${run.agent.reflexVersion ? ` v${run.agent.reflexVersion}` : ''}`}
        >
          {run.agent.name.replace(/^reflex:/, '')}
        </span>
      ),
      hideOnMobile: true,
    },
    {
      id: 'outcome',
      header: 'Outcome',
      cell: (run) => (
        <Chip
          tone={STATUS_TONE[run.status as keyof typeof STATUS_TONE] ?? 'ash'}
          variant="soft"
          size="sm"
        >
          {run.status}
        </Chip>
      ),
    },
    {
      id: 'verified',
      header: 'Verified',
      cell: (run) => <VerificationChip status={run.verification} />,
      hideOnMobile: true,
    },
    {
      id: 'calls',
      header: 'Model calls',
      cell: (run) => run.usage.modelCalls,
      align: 'end',
      mono: true,
      hideOnMobile: true,
    },
    {
      id: 'tokens',
      header: 'Tokens',
      cell: (run) => formatTokens(run.usage.totalTokens),
      align: 'end',
      mono: true,
    },
    {
      id: 'commands',
      header: 'Commands',
      cell: (run) => run.usage.commands,
      align: 'end',
      mono: true,
      hideOnMobile: true,
    },
    {
      id: 'local',
      header: 'Local time',
      cell: (run) => formatMs(run.usage.localMs),
      align: 'end',
      mono: true,
      hideOnMobile: true,
    },
    {
      id: 'blocked',
      header: 'Blocked',
      cell: (run) =>
        run.usage.blockedActions > 0 ? (
          <span className="trace-blocked">
            <ShieldAlert size={13} aria-hidden="true" /> {run.usage.blockedActions}
          </span>
        ) : (
          <span className="faint">0</span>
        ),
      align: 'end',
      mono: true,
      hideOnMobile: true,
    },
    {
      id: 'inspect',
      header: <span className="sr-only">Inspect</span>,
      cell: (run) => (
        <Link
          className="trace-inspect"
          to={tracePath(run.id)}
          onClick={(event) => {
            event.stopPropagation();
          }}
          aria-label={`Inspect the trace of run ${run.id}`}
        >
          Inspect
        </Link>
      ),
      width: 76,
    },
  ];

  return (
    <Page title="Traces" className="trace-page">
      <PageHeader
        title="Traces"
        question="What did the agent actually do?"
        eyebrow="Forge stage · Observe"
        meta={
          runs.data ? (
            <span>
              {plural(total, 'run')} recorded{filtered ? ' with these filters' : ''}. Every run is a
              vendor-neutral trace of model calls, commands, decisions and verification.
            </span>
          ) : undefined
        }
        actions={
          <ButtonLink to={runPath()} icon={<ScrollText size={14} />}>
            Open the Run Console
          </ButtonLink>
        }
      />

      <div className="trace-filters" role="search" aria-label="Filter traces">
        <div className="trace-kinds" role="group" aria-label="Kind of run">
          <button
            type="button"
            className="trace-kind"
            aria-pressed={filters.kind === null}
            onClick={() => {
              filters.set({ kind: null });
            }}
          >
            All runs <span className="num trace-kind__n">{counts.total ?? ''}</span>
          </button>
          {TRACE_KINDS.filter(
            (kind) => (counts.byKind.get(kind) ?? 0) > 0 || filters.kind === kind,
          ).map((kind) => (
            <button
              key={kind}
              type="button"
              className="trace-kind"
              aria-pressed={filters.kind === kind}
              onClick={() => {
                filters.set({ kind });
              }}
            >
              {KIND_LABEL[kind]}{' '}
              <span className="num trace-kind__n">{counts.byKind.get(kind) ?? ''}</span>
            </button>
          ))}
        </div>
        <Field label="Task">
          {(control) => (
            <select
              className="bf-select"
              {...control}
              value={filters.task ?? ''}
              onChange={(event) => {
                filters.set({ task: event.target.value || null });
              }}
            >
              <option value="">All tasks</option>
              {taskIndex.tasks.map((task) => (
                <option key={task.id} value={task.id}>
                  {task.scenarioId} ({task.origin}) {task.title}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Button
          variant="ghost"
          disabled={!filtered}
          onClick={filters.clear}
          {...(!filtered ? { disabledReason: 'No filter is set.' } : {})}
        >
          Clear filters
        </Button>
        <p className="trace-legend">
          <span className="micro">Figures</span>
          <span>
            Model calls, tokens <Provenance kind="synthetic" metric="tokens_per_task" />
          </span>
          <span>
            Commands, local time <Provenance kind="measured" metric="local_time" />
          </span>
        </p>
      </div>

      <section className="trace-tablewrap" data-testid="trace-table" aria-label="Runs" {...target}>
        <DataTable
          caption="Recorded runs, newest first. Select a row to open its trace."
          columns={columns}
          rows={runs.isPending ? undefined : rows}
          getRowId={(run) => run.id}
          onSelect={(run) => {
            void navigate(tracePath(run.id));
          }}
          loading={runs.isPending}
          error={runs.error ?? undefined}
          onRetry={() => void runs.refetch()}
          maxHeight="calc(100dvh - 330px)"
          dense
          skeletonRows={8}
          rowTone={(run) =>
            run.verification === 'fail' || run.status === 'stopped'
              ? 'crimson'
              : run.usage.blockedActions > 0
                ? 'amber'
                : undefined
          }
          empty={
            filtered ? (
              <EmptyState
                compact
                title="No runs match these filters"
                description="Widen the kind or pick another task."
                action={<Button onClick={filters.clear}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                compact
                title="No traces yet"
                description="A trace is recorded every time an agent runs. Send a failure and run the baseline agent to record the first one."
                action={<ButtonLink to={runPath()}>Go to the Run Console</ButtonLink>}
              />
            )
          }
          footer={
            runs.data ? (
              <>
                <span>
                  Showing {rows.length} of {total}
                  {filtered ? ' matching runs' : ' runs'}. Tokens are synthetic (deterministic
                  provider); local time is measured.
                </span>
                {runs.hasNextPage ? (
                  <Button
                    size="sm"
                    loading={runs.isFetchingNextPage}
                    onClick={() => void runs.fetchNextPage()}
                  >
                    Load more
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        />
      </section>
    </Page>
  );
}
