import { useQueryClient } from '@tanstack/react-query';
import { Inbox } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ApiError, errorMessage } from '../../api/client';
import {
  useEnvironment,
  useIntakeTask,
  useMatchTask,
  useReflexes,
  useRunTask,
  useScenarios,
  useTask,
} from '../../api/hooks';
import { keys } from '../../api/keys';
import type { RunMode } from '../../api/types';
import { useAuth } from '../../auth/useAuth';
import { useRunParams } from '../../routeParams';
import { runPath } from '../../routes';
import {
  Button,
  EmptyState,
  ErrorState,
  Page,
  PageHeader,
  Skeleton,
  SkeletonGroup,
  formatTokens,
  plural,
  useToast,
} from '../../ui';
import { ExecutionView } from './ExecutionView';
import { RecentRuns, RunStrip } from './Lists';
import { MatchPanel } from './MatchPanel';
import { ResultHeader } from './ResultHeader';
import { RunActions } from './RunActions';
import { TaskPanel } from './TaskPanel';
import { TaskRail } from './TaskRail';
import { useRun, useRunComparison } from './hooks';
import {
  defaultRun,
  newestVersionOf,
  nextScenario,
  pathVerdict,
  relationsOf,
  runAvailability,
  selectExecutable,
} from './selectors';
import '../../styles/run.css';

/** A missing id is an error with a way back, not a crash and not a bare "Retry". */
function NotFound({
  title,
  error,
  to,
  label,
}: {
  title: string;
  error: unknown;
  to: string;
  label: string;
}) {
  return (
    <div className="run-notfound">
      <ErrorState title={title} error={error} />
      <p>
        <Link to={to}>{label}</Link>
      </p>
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <SkeletonGroup label="Loading the task" className="run-canvas__skeleton">
      <Skeleton height={28} width="55%" />
      <Skeleton height={16} width="80%" />
      <Skeleton height={260} radius={8} />
      <Skeleton height={200} radius={8} />
    </SkeletonGroup>
  );
}

export default function RunConsole() {
  const { task: taskParam, run: runParam, setParams } = useRunParams();
  const auth = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();

  const scenarios = useScenarios();
  const environment = useEnvironment();
  const reflexes = useReflexes();
  const requested = useRun(runParam);
  const taskId = taskParam ?? requested.data?.taskId ?? null;
  const task = useTask(taskId);

  const taskRuns = useMemo(() => task.data?.runs ?? [], [task.data]);
  const requestedMissing = requested.error instanceof ApiError && requested.error.status === 404;
  const runElsewhere = Boolean(
    runParam && requested.data && taskId && requested.data.taskId !== taskId,
  );
  const defaultId = defaultRun(taskRuns)?.id ?? null;
  const selectedRunId = requestedMissing || runElsewhere ? defaultId : (runParam ?? defaultId);
  const run = useRun(selectedRunId);

  const comparison = useRunComparison(run.data);
  const referenceId = comparison.comparison?.baselineRunId ?? null;
  const reference = useRun(referenceId);
  const selectedSummary = taskRuns.find((entry) => entry.id === selectedRunId) ?? run.data ?? null;
  const relations = useMemo(
    () =>
      selectedSummary
        ? relationsOf(selectedSummary, taskRuns, referenceId)
        : { partner: null, role: null, fallback: null },
    [selectedSummary, taskRuns, referenceId],
  );
  const fallback = useRun(relations.fallback?.id ?? null);

  const intake = useIntakeTask();
  const rematch = useMatchTask();
  const runTask = useRunTask();

  const [armedChoice, setArmedChoice] = useState<string | null>(null);
  const catalogue = scenarios.data?.scenarios;
  const armed =
    (catalogue
      ? (catalogue.find((scenario) => scenario.id === armedChoice && scenario.taskId === null) ??
        nextScenario(catalogue))
      : null) ?? null;
  const allSent = Boolean(
    catalogue && catalogue.length > 0 && catalogue.every((scenario) => scenario.taskId !== null),
  );
  const openScenarioId = task.data?.scenarioId ?? null;

  const canRun = auth.can('run_task');
  const roleReason =
    'You are signed in with a read-only role. An operator, reviewer or admin can do this.';
  const sendDisabledReason = !canRun
    ? `Sending a failure needs an operator, reviewer or admin. ${roleReason}`
    : allSent
      ? 'Every failure scenario has already been received. Reset the demo to start again.'
      : null;

  const match = task.data?.match ?? null;
  const choice =
    match?.decision === 'match' ? selectExecutable(reflexes.data?.reflexes, match.familyId) : null;
  const newest =
    match?.decision === 'match' ? newestVersionOf(reflexes.data?.reflexes, match.familyId) : null;
  const availability = runAvailability({
    canRun,
    taskStatus: task.data?.status ?? 'received',
    match,
    choice,
    newest,
  });
  const verdict = pathVerdict({ match, choice });

  const send = async () => {
    if (!armed) return;
    try {
      const detail = await intake.mutateAsync(armed.id);
      setArmedChoice(null);
      setParams({ task: detail.id, run: null });
      toast({
        title: 'Failure received',
        description: `${armed.id}: ${armed.title}`,
        tone: 'success',
      });
    } catch (error) {
      toast({
        title: 'Could not send the failure',
        description: errorMessage(error),
        tone: 'danger',
      });
    }
  };

  const start = async (mode: RunMode) => {
    if (!taskId) return;
    try {
      const result = await runTask.mutateAsync({ taskId, mode });
      for (const detail of [result.primary, result.reference, result.fallback]) {
        if (detail) qc.setQueryData(keys.runs.detail(detail.id), detail);
      }
      setParams({ task: taskId, run: result.primary.id });
      toast({
        title:
          result.primary.kind === 'reflex' ? 'The Reflex finished' : 'The baseline agent finished',
        description: `${result.primary.outcomeSummary}. ${plural(result.primary.usage.modelCalls, 'model call')}, ${formatTokens(result.primary.usage.totalTokens)} tokens (synthetic).`,
        tone: result.primary.status === 'success' ? 'success' : 'warning',
      });
    } catch (error) {
      toast({
        title: 'The run did not complete',
        description: errorMessage(error),
        tone: 'danger',
      });
    }
  };

  const runningMode: RunMode | null = runTask.isPending ? (runTask.variables.mode ?? null) : null;
  const taskMissing = task.error instanceof ApiError && task.error.status === 404;
  const referenceState =
    comparison.comparison === null
      ? 'none'
      : reference.isPending
        ? 'loading'
        : reference.error
          ? 'error'
          : 'ready';
  const rematchDisabled = canRun
    ? null
    : `Matching a task needs an operator, reviewer or admin. ${roleReason}`;

  const canvas = (() => {
    if (!taskId && runParam && requested.isPending) return <CanvasSkeleton />;
    if (!taskId && runParam && requestedMissing) {
      return (
        <NotFound
          title="That run does not exist"
          error={requested.error}
          to={runPath()}
          label="Back to the Run Console"
        />
      );
    }
    if (!taskId) {
      return (
        <EmptyState
          icon={<Inbox size={20} />}
          title="No failure on the console yet"
          description={
            armed
              ? `Send a failure to BigForge to see what happens to it. The next one is ${armed.id}: "${armed.title}".`
              : 'Send a failure to BigForge to see what happens to it.'
          }
          action={
            <ol className="run-steps">
              <li>
                <span className="run-steps__n" aria-hidden="true">
                  1
                </span>{' '}
                Send the failure: BigForge captures the task and its CI log.
              </li>
              <li>
                <span className="run-steps__n" aria-hidden="true">
                  2
                </span>{' '}
                It is fingerprinted and matched against known task families.
              </li>
              <li>
                <span className="run-steps__n" aria-hidden="true">
                  3
                </span>{' '}
                Run the baseline agent, the Reflex, or both side by side.
              </li>
            </ol>
          }
          className="run-empty"
        />
      );
    }
    if (taskMissing) {
      return (
        <NotFound
          title="That task does not exist"
          error={task.error}
          to={runPath()}
          label="Back to the Run Console"
        />
      );
    }
    if (task.error) {
      return (
        <ErrorState
          title="Could not load this task"
          error={task.error}
          onRetry={() => void task.refetch()}
        />
      );
    }
    if (task.isPending || !task.data) return <CanvasSkeleton />;

    const data = task.data;
    const rootFailure =
      run.data?.rootFailure ??
      taskRuns.find((entry) => entry.rootFailure !== null)?.rootFailure ??
      null;
    return (
      <>
        <TaskPanel task={data} rootFailure={rootFailure} />
        <div className="run-decision">
          <MatchPanel
            task={data}
            choice={choice}
            newest={newest}
            rematch={{
              running: rematch.isPending,
              disabledReason: rematchDisabled,
              onRun: () => {
                rematch.mutate(data.id, {
                  onError: (error) => {
                    toast({
                      title: 'Matching failed',
                      description: errorMessage(error),
                      tone: 'danger',
                    });
                  },
                });
              },
            }}
          />
          <RunActions
            availability={availability}
            running={runningMode}
            error={runTask.error}
            pathSummary={
              verdict.path === 'reflex'
                ? `Auto would take the Reflex path: ${verdict.label}.`
                : 'Auto would take the baseline path: no Reflex applies.'
            }
            onRun={(mode) => void start(mode)}
          />
        </div>

        {runElsewhere ? (
          <p className="run-notice" role="status">
            The run in the link belongs to a different task, so this task&rsquo;s own run is shown.{' '}
            <Link to={runPath({ task: data.id })}>Clear the run from the link</Link>
          </p>
        ) : null}
        <RunStrip
          runs={taskRuns}
          selectedId={selectedRunId}
          onSelect={(id) => {
            setParams({ task: data.id, run: id });
          }}
        />

        {requestedMissing ? (
          <NotFound
            title="That run does not exist"
            error={requested.error}
            to={runPath({ task: data.id })}
            label="Show this task's latest run"
          />
        ) : taskRuns.length === 0 ? (
          <EmptyState
            title="This task has not been run yet"
            description={
              canRun
                ? 'Run the baseline agent first. BigForge records every model call and command as a trace it can learn from.'
                : 'Nothing has run on this task yet. An operator can run it.'
            }
            className="run-empty run-empty--inline"
          />
        ) : run.error ? (
          <ErrorState
            title={
              run.error instanceof ApiError && run.error.status === 404
                ? 'That run does not exist'
                : 'Could not load this run'
            }
            error={run.error}
            onRetry={() => {
              if (run.error instanceof ApiError && run.error.status === 404)
                setParams({ task: data.id, run: null });
              else void run.refetch();
            }}
          />
        ) : run.isPending || !run.data ? (
          <CanvasSkeleton />
        ) : (
          <>
            <ResultHeader
              run={run.data}
              exec={run.data.exec}
              relations={relations}
              versus={
                comparison.comparison && reference.data
                  ? { comparison: comparison.comparison.comparison, baseline: reference.data.usage }
                  : null
              }
            />
            <ExecutionView
              key={`${run.data.id}:${reference.data?.id ?? 'none'}`}
              run={run.data}
              reference={reference.data ?? null}
              referenceState={referenceState}
              comparison={comparison.comparison}
              comparisonPending={comparison.pending}
              fallback={fallback.data ?? null}
              fallbackPending={Boolean(relations.fallback) && fallback.isPending}
            />
          </>
        )}
        <RecentRuns scenarios={catalogue} currentRunId={selectedRunId} />
      </>
    );
  })();

  return (
    <Page title="Run Console" className="run-page">
      <PageHeader
        title="Run Console"
        question="What happens to this task?"
        eyebrow="Forge stage · Execute"
        actions={
          task.data ? (
            <Button
              variant="ghost"
              onClick={() => {
                setParams({ task: null, run: null });
              }}
            >
              Clear task
            </Button>
          ) : undefined
        }
      />
      <div className="run-layout">
        <TaskRail
          scenarios={catalogue}
          loading={scenarios.isPending}
          error={scenarios.error}
          onRetry={() => void scenarios.refetch()}
          environment={environment.data}
          openScenarioId={openScenarioId}
          armed={armed}
          onArm={setArmedChoice}
          onOpenTask={(id) => {
            setParams({ task: id, run: null });
          }}
          onSend={() => void send()}
          sending={intake.isPending}
          sendDisabledReason={sendDisabledReason}
        />
        <div className="run-canvas" data-testid="run-canvas">
          {canvas}
        </div>
      </div>
    </Page>
  );
}
