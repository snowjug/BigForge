import { ArrowLeft, Play } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useParams } from 'react-router';
import { ApiError } from '../../api/client';
import { useEnvironment, useRun } from '../../api/hooks';
import { useDemoTarget } from '../../demo/useDemo';
import { runPath, tracesPath } from '../../routes';
import {
  ButtonLink,
  Chip,
  EmptyState,
  ErrorState,
  Metric,
  Page,
  PageHeader,
  Panel,
  Skeleton,
  SkeletonGroup,
  formatMs,
  formatTimestamp,
  formatTokens,
  formatUsd,
  plural,
} from '../../ui';
import { KIND_LABEL, isReflexKind } from '../run/selectors';
import { LearnSafety } from './LearnSafety';
import { EventInspector, TraceTimeline } from './TraceTimeline';
import { useCompileInfo } from './hooks';
import { assessTrace } from './safety';
import { buildTimeline } from './timeline';
import '../../styles/traces.css';

const STATUS_TONE = {
  success: 'jade',
  failed: 'crimson',
  stopped: 'amber',
  fallback: 'amber',
} as const;

export default function TraceDetail() {
  const { runId } = useParams<{ runId: string }>();
  const run = useRun(runId ?? null);
  const environment = useEnvironment();
  const target = useDemoTarget('trace_captured');
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const data = run.data;
  const rows = useMemo(() => (data ? buildTimeline(data.trace) : []), [data]);
  const markers = useMemo(() => rows.reduce((sum, row) => sum + row.redactions, 0), [rows]);
  const canBeSource = data?.kind === 'baseline';
  const compile = useCompileInfo(data?.trace.id ?? null, canBeSource === true);
  const assessment = useMemo(
    () =>
      data
        ? assessTrace({
            trace: data.trace,
            kind: data.kind,
            groupId: data.groupId,
            compile: compile.info,
            currentToolchain: environment.data?.toolchainVersion ?? null,
            redactionMarkers: markers,
          })
        : null,
    [data, compile.info, environment.data, markers],
  );

  const selectedIndex = rows.findIndex((row) => row.key === selectedKey);
  const selectedRow = selectedIndex >= 0 ? (rows[selectedIndex] ?? null) : null;
  const notFound = run.error instanceof ApiError && run.error.status === 404;

  return (
    <Page title={data ? `Trace ${data.task.scenarioId}` : 'Trace'} className="trace-page">
      <PageHeader
        title="Trace"
        eyebrow="Forge stage · Observe"
        question="What did the agent actually do?"
        meta={data ? <span>{data.task.title}</span> : undefined}
        actions={
          <>
            <ButtonLink to={tracesPath()} icon={<ArrowLeft size={14} />}>
              All traces
            </ButtonLink>
            {data ? (
              <ButtonLink
                variant="primary"
                to={runPath({ task: data.taskId, run: data.id })}
                icon={<Play size={14} />}
              >
                Open in the Run Console
              </ButtonLink>
            ) : null}
          </>
        }
      />

      {notFound ? (
        <ErrorState
          title="That trace does not exist"
          error={run.error}
          onRetry={() => {
            void run.refetch();
          }}
        />
      ) : run.error ? (
        <ErrorState
          title="Could not load this trace"
          error={run.error}
          onRetry={() => void run.refetch()}
        />
      ) : run.isPending || !data || !assessment ? (
        <SkeletonGroup label="Loading the trace" className="trace-skeleton">
          <Skeleton height={64} radius={8} />
          <div className="trace-layout">
            <Skeleton height={420} radius={8} />
            <Skeleton height={420} radius={8} />
          </div>
        </SkeletonGroup>
      ) : (
        <>
          <section className="trace-summary" aria-label="Run summary">
            <div className="trace-summary__chips">
              <Chip tone={isReflexKind(data.kind) ? 'steel' : 'ember'} variant="outline">
                {KIND_LABEL[data.kind]}
              </Chip>
              <Chip tone="ash" variant="outline" mono>
                {data.agent.name}
                {data.agent.reflexVersion ? ` v${data.agent.reflexVersion}` : ''}
              </Chip>
              <Chip
                tone={STATUS_TONE[data.status as keyof typeof STATUS_TONE] ?? 'ash'}
                variant="soft"
              >
                {data.status}
              </Chip>
              <Chip
                tone="ash"
                variant="outline"
                dashed
                title={`Provider ${data.provider.id}, model ${data.provider.model}`}
              >
                {data.provider.mode === 'deterministic'
                  ? 'Deterministic provider, synthetic'
                  : `Live provider ${data.provider.model}`}
              </Chip>
              <span className="faint trace-summary__when">
                <span className="mono">{data.id}</span> &middot;{' '}
                {formatTimestamp(data.trace.startedAt)} &middot;{' '}
                {data.trace.environment.toolchain.name} {data.trace.environment.toolchain.version}
              </span>
            </div>
            <div className="trace-metrics">
              <Metric
                label="Model calls"
                size="sm"
                value={formatTokens(data.usage.modelCalls)}
                provenance={data.usage.tokenProvenance}
                definition="model_calls"
              />
              <Metric
                label="Tokens"
                size="sm"
                value={formatTokens(data.usage.totalTokens)}
                provenance={data.usage.tokenProvenance}
                definition="tokens_per_task"
              />
              <Metric
                label="Cost"
                size="sm"
                value={formatUsd(data.usage.costUsd)}
                provenance={data.usage.costProvenance}
                definition="cost_usd"
              />
              <Metric
                label="Commands"
                size="sm"
                value={formatTokens(data.usage.commands)}
                provenance="measured"
                definition="commands"
              />
              <Metric
                label="Model latency"
                size="sm"
                value={formatMs(data.usage.modelLatencyMs)}
                provenance={data.usage.modelLatencyProvenance}
                definition="model_latency"
              />
              <Metric
                label="Local time"
                size="sm"
                value={formatMs(data.usage.localMs)}
                provenance={data.usage.localMsProvenance}
                definition="local_time"
              />
              <Metric
                label="Blocked actions"
                size="sm"
                value={formatTokens(data.usage.blockedActions)}
                provenance="measured"
                tone={data.usage.blockedActions > 0 ? 'crimson' : undefined}
              />
            </div>
          </section>

          <div className="trace-layout">
            <section className="trace-main" aria-labelledby="trace-tl-title" {...target}>
              <Panel
                title={<span id="trace-tl-title">Timeline</span>}
                subtitle={`${plural(data.trace.events.length, 'event')} on the virtual clock: simulated model latency plus measured local time. Select an event for everything recorded about it.`}
                variant="flush"
              >
                {rows.length <= 1 ? (
                  <EmptyState
                    compact
                    title="No events were recorded"
                    description="This run has no model calls or commands in its trace."
                  />
                ) : (
                  <TraceTimeline rows={rows} selectedKey={selectedKey} onSelect={setSelectedKey} />
                )}
              </Panel>
            </section>
            <div className="trace-aside">
              <LearnSafety assessment={assessment} loadingCompile={compile.loading} />
            </div>
          </div>
          <EventInspector
            row={selectedRow}
            runId={data.id}
            taskId={data.taskId}
            onClose={() => {
              setSelectedKey(null);
            }}
            onStep={(delta) => {
              const next = rows[selectedIndex + delta];
              if (next) setSelectedKey(next.key);
            }}
            hasPrevious={selectedIndex > 0}
            hasNext={selectedIndex >= 0 && selectedIndex < rows.length - 1}
          />
        </>
      )}
    </Page>
  );
}
