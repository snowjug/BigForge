import type { ComparisonDto, ReflexStep, RunDetailDto } from '@bigforge/schemas';
import { Gauge, ListTree, Scale, Workflow } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useReflexExport } from '../../api/hooks';
import { useDemoTarget } from '../../demo/useDemo';
import { useForgeStage } from '../../shell/stageStore';
import { useReducedMotion } from '../../theme/prefs';
import {
  Chip,
  EmptyState,
  ErrorState,
  Panel,
  Provenance,
  Skeleton,
  formatMs,
  formatPct,
  formatTokens,
  plural,
} from '../../ui';
import { ForgeGraph } from '../../viz';
import { nodeBadges, nodeStatesAt, stopFracture } from '../../viz/exec/graphStates';
import { PlaybackLanes } from '../../viz/exec/PlaybackLanes';
import { activeAt, buildLane, buildPlayback } from '../../viz/exec/playback';
import { TokenFlow } from '../../viz/exec/TokenFlow';
import { UncertaintyLens } from '../../viz/exec/UncertaintyLens';
import { usePlayback } from '../../viz/exec/usePlayback';
import { ComparisonPanel, FallbackStory } from './ComparisonPanel';
import { isReflexKind } from './selectors';

type ReferenceState = 'none' | 'loading' | 'error' | 'ready';

export interface ExecutionViewProps {
  run: RunDetailDto;
  reference: RunDetailDto | null;
  referenceState: ReferenceState;
  comparison: ComparisonDto | null;
  comparisonPending: boolean;
  fallback: RunDetailDto | null;
  fallbackPending: boolean;
}

function StepInspector({
  step,
  run,
  stepResult,
}: {
  step: ReflexStep;
  run: RunDetailDto;
  stepResult: NonNullable<RunDetailDto['exec']>['steps'][number] | undefined;
}) {
  const block = run.trace.events.find((event) => event.kind === 'step' && event.stepId === step.id);
  const duration = block && block.kind === 'step' ? block.durationMs : null;
  const crossed = stepResult?.status === 'escalated';
  return (
    <div className="run-inspector" aria-live="polite" data-testid="step-inspector">
      <div className="run-inspector__head">
        <p className="run-inspector__title">{step.title}</p>
        <Chip
          tone={step.kind === 'verification' ? 'jade' : crossed ? 'molten' : 'steel'}
          variant="outline"
          size="sm"
        >
          {step.kind}
        </Chip>
        {stepResult ? (
          <Chip
            tone={
              stepResult.status === 'ok'
                ? 'steel'
                : stepResult.status === 'escalated'
                  ? 'molten'
                  : stepResult.status === 'stopped'
                    ? 'crimson'
                    : 'ash'
            }
            variant="soft"
            size="sm"
          >
            {stepResult.status === 'escalated' ? 'crossed its boundary' : stepResult.status}
          </Chip>
        ) : (
          <Chip tone="ash" variant="outline" size="sm" dashed>
            not reached
          </Chip>
        )}
      </div>
      {stepResult ? <p className="dim run-inspector__sum">{stepResult.summary}</p> : null}
      <dl className="run-inspector__grid">
        <div>
          <dt className="micro">Operator</dt>
          <dd className="mono">{step.operator.id.replace('local.', '')}</dd>
        </div>
        <div>
          <dt className="micro">Executor</dt>
          <dd>
            {stepResult
              ? stepResult.executor === 'local'
                ? 'local, 0 model calls'
                : 'a model, through the firewall'
              : '\u2014'}
          </dd>
        </div>
        <div>
          <dt className="micro">Duration</dt>
          <dd className="num">
            {duration === null ? '\u2014' : formatMs(duration)}{' '}
            {duration !== null ? (
              <Provenance
                kind={crossed ? ['simulated', 'measured'] : 'measured'}
                metric={crossed ? 'model_latency' : 'local_time'}
              />
            ) : null}
          </dd>
        </div>
        <div>
          <dt className="micro">Replaces baseline behaviour</dt>
          <dd className="mono">
            {step.rationale.replaces.length > 0
              ? step.rationale.replaces.join(', ')
              : 'nothing (a guard or a check)'}
          </dd>
        </div>
        <div>
          <dt className="micro">Baseline tokens replaced</dt>
          <dd className="num">
            {formatTokens(step.rationale.baselineTokens)}{' '}
            <Provenance kind="synthetic" metric="tokens_per_task" />
          </dd>
        </div>
        <div>
          <dt className="micro">Seen in every source trace</dt>
          <dd className="num">{formatPct(step.rationale.conservation, { digits: 0 })}</dd>
        </div>
        <div>
          <dt className="micro">Guards</dt>
          <dd>
            {step.escalateWhen.length > 0
              ? `${plural(step.escalateWhen.length, 'escalate condition')}`
              : 'no escalation'}
            {step.stopWhen.length > 0 ? `, ${plural(step.stopWhen.length, 'stop condition')}` : ''}
          </dd>
        </div>
      </dl>
    </div>
  );
}

export function ExecutionView({
  run,
  reference,
  referenceState,
  comparison,
  comparisonPending,
  fallback,
  fallbackPending,
}: ExecutionViewProps) {
  const reduced = useReducedMotion();
  const reflexRun = isReflexKind(run.kind);
  const exec = run.exec;
  const boundaries = useMemo(() => exec?.boundaries ?? [], [exec]);
  const specQuery = useReflexExport(reflexRun ? run.reflexVersionId : null);
  const spec = specQuery.data?.spec;

  const graphTarget = useDemoTarget(['known_steps', 'boundary', 'continues']);
  const comparisonTarget = useDemoTarget('comparison');
  const baselineTarget = useDemoTarget('baseline_handles');

  const baselineSource = reflexRun ? reference : run;
  const baselineLane = useMemo(
    () => (baselineSource ? buildLane('baseline', baselineSource) : null),
    [baselineSource],
  );
  const reflexLane = useMemo(() => (reflexRun ? buildLane('reflex', run) : null), [reflexRun, run]);
  const playback = useMemo(
    () => buildPlayback([baselineLane, reflexLane].filter((lane) => lane !== null)),
    [baselineLane, reflexLane],
  );
  const controls = usePlayback(playback, { reducedMotion: reduced });

  // Escalate glows only while the playhead is inside the boundary call; otherwise the guided demo and the route decide.
  const crossing =
    controls.playing && reflexLane !== null && activeAt(reflexLane, controls.t)?.type === 'model';
  useForgeStage(crossing ? ['escalate'] : null);

  const [picked, setPicked] = useState<string | null>(null);
  const selectedId = picked ?? boundaries[0]?.stepId ?? null;

  const states = useMemo(
    () =>
      spec && exec && reflexLane
        ? nodeStatesAt(spec.steps, exec, run.verification, reflexLane, controls.t)
        : {},
    [spec, exec, reflexLane, run.verification, controls.t],
  );
  const badges = useMemo(
    () => (spec && exec && reflexLane ? nodeBadges(spec.steps, exec, reflexLane) : {}),
    [spec, exec, reflexLane],
  );
  const fracture = exec ? stopFracture(exec) : null;
  const replacedKeys = useMemo(() => {
    if (!spec || boundaries.length === 0) return null;
    const ids = new Set(boundaries.map((boundary) => boundary.stepId));
    const keys = spec.steps
      .filter((step) => ids.has(step.id))
      .flatMap((step) => step.rationale.replaces);
    return keys.length > 0 ? new Set(keys) : null;
  }, [spec, boundaries]);
  const selectedStep = spec?.steps.find((step) => step.id === selectedId) ?? null;

  const localSteps = exec
    ? exec.steps.filter((step) => step.executor === 'local' && step.status !== 'skipped').length
    : 0;
  const stepTotal = spec?.steps.length ?? exec?.steps.length ?? 0;

  const sections: { id: string; label: string; icon: ReactNode }[] = [];
  if (reflexRun)
    sections.push({ id: 'run-sec-graph', label: 'Reflex graph', icon: <Workflow size={14} /> });
  sections.push({ id: 'run-sec-playback', label: 'Playback', icon: <Scale size={14} /> });
  if (reflexRun)
    sections.push({ id: 'run-sec-lens', label: 'Uncertainty Lens', icon: <Gauge size={14} /> });
  sections.push({ id: 'run-sec-flow', label: 'Token Flow', icon: <ListTree size={14} /> });
  if (reflexRun)
    sections.push({ id: 'run-sec-compare', label: 'Comparison', icon: <Scale size={14} /> });

  const jump = (id: string) => {
    document
      .getElementById(id)
      ?.scrollIntoView({ block: 'start', behavior: reduced ? 'auto' : 'smooth' });
  };

  const showStopStory = reflexRun && run.status === 'stopped';

  return (
    <div className="run-exec" data-testid="run-execution">
      <nav className="run-jump" aria-label="Sections of this run">
        <span className="micro">Jump to</span>
        {sections.map((section) => (
          <button
            key={section.id}
            type="button"
            className="run-jump__btn"
            onClick={() => {
              jump(section.id);
            }}
          >
            {section.icon}
            {section.label}
          </button>
        ))}
      </nav>

      {reflexRun ? (
        <section
          id="run-sec-graph"
          className="run-region"
          data-testid="forge-graph"
          aria-labelledby="run-graph-title"
          {...graphTarget}
        >
          <Panel
            title={<span id="run-graph-title">Reflex execution</span>}
            subtitle={
              exec
                ? `${localSteps} of ${plural(stepTotal, 'step')} ran locally with 0 model calls${boundaries.length > 0 ? `; ${plural(boundaries.length, 'step')} crossed the uncertainty boundary` : ''}${exec.status === 'stopped' ? `; stopped at ${exec.stopStepId ?? 'a step'}` : ''}`
                : 'The compiled steps of the Reflex and what happened to each'
            }
            actions={
              <>
                {exec?.crr !== null && exec?.crr !== undefined ? (
                  <Chip
                    tone="steel"
                    variant="outline"
                    title="Cognitive Reuse Ratio: share of the workflow done without a model, weighted by baseline tokens (a proposed metric)"
                  >
                    Reuse (CRR) {formatPct(exec.crr, { digits: 1 })}
                  </Chip>
                ) : null}
                <Provenance kind="synthetic" metric="crr" />
              </>
            }
          >
            {specQuery.isPending ? (
              <div className="run-skel" aria-busy="true" aria-label="Loading the Reflex steps">
                <Skeleton height={240} radius={8} />
              </div>
            ) : specQuery.error || !spec ? (
              <ErrorState
                compact
                title="Could not load the Reflex steps"
                error={specQuery.error ?? undefined}
                onRetry={() => void specQuery.refetch()}
              />
            ) : (
              <>
                <ForgeGraph
                  steps={spec.steps}
                  states={states}
                  badges={badges}
                  fracture={fracture}
                  selectedId={selectedId}
                  onSelect={(id) => {
                    setPicked(id);
                  }}
                  ariaLabel={`Steps of ${spec.name} version ${spec.version} in this run. ${localSteps} of ${stepTotal} ran locally${boundaries.length > 0 ? ', one crossed its uncertainty boundary' : ''}.`}
                />
                {selectedStep ? (
                  <StepInspector
                    step={selectedStep}
                    run={run}
                    stepResult={exec?.steps.find((step) => step.stepId === selectedStep.id)}
                  />
                ) : (
                  <p className="faint run-inspector__hint">
                    Select a step to see why it ran and what it replaced.
                  </p>
                )}
              </>
            )}
          </Panel>
        </section>
      ) : null}

      <section
        id="run-sec-playback"
        className="run-region"
        aria-labelledby="run-playback-title"
        {...(reflexRun ? comparisonTarget : baselineTarget)}
      >
        <Panel
          title={
            <span id="run-playback-title">
              {reflexRun ? 'Baseline vs Reflex, one shared time axis' : 'Baseline agent execution'}
            </span>
          }
          subtitle={
            reflexRun
              ? 'Press play: the Reflex finishes while the baseline is still thinking.'
              : 'Every model call (ember, taller means more tokens) and every command the agent ran.'
          }
        >
          {reflexRun && referenceState === 'loading' ? (
            <div
              className="run-skel"
              aria-busy="true"
              aria-label="Loading the baseline reference run"
            >
              <Skeleton height={260} radius={8} />
            </div>
          ) : (
            <>
              {reflexRun && referenceState === 'error' ? (
                <ErrorState compact title="Could not load the baseline reference run" />
              ) : null}
              <PlaybackLanes
                baseline={baselineLane}
                reflex={reflexLane}
                controls={controls}
                reflexLabel={`${run.agent.name.replace(/^reflex:/, '')}${run.agent.reflexVersion ? ` v${run.agent.reflexVersion}` : ''}`}
                baselineLabel={baselineSource?.trace.provider.model}
                noBaselineNote={
                  reflexRun
                    ? 'No baseline reference was recorded for this run, so there is nothing to put beside it. Use Run compare above to measure one on the same task.'
                    : undefined
                }
              />
            </>
          )}
        </Panel>
      </section>

      {reflexRun ? (
        <section id="run-sec-lens" className="run-region" aria-labelledby="run-lens-title">
          <Panel
            title={<span id="run-lens-title">Uncertainty Lens</span>}
            subtitle="The one decision a model had to make, and the little evidence it was allowed to see"
          >
            {boundaries.length > 0 ? (
              <UncertaintyLens boundaries={boundaries} />
            ) : (
              <EmptyState
                compact
                title={
                  run.status === 'stopped'
                    ? 'The Reflex stopped before it needed a model'
                    : 'No uncertainty boundary was crossed'
                }
                description={
                  run.status === 'stopped'
                    ? 'It stopped on a guard instead of guessing, so no model call was made.'
                    : `Every step was decided locally: ${plural(stepTotal, 'step')}, 0 model calls. Nothing had to pass the Token Firewall.`
                }
              />
            )}
          </Panel>
        </section>
      ) : null}

      <section id="run-sec-flow" className="run-region" aria-labelledby="run-flow-title">
        <Panel
          title={<span id="run-flow-title">Token Flow</span>}
          subtitle="Where the baseline's tokens went, and what BigForge still had to send"
        >
          {baselineSource ? (
            <TokenFlow
              baselineEvents={baselineSource.trace.events}
              reflex={
                reflexRun
                  ? {
                      total: run.usage.totalTokens,
                      input: run.usage.inputTokens,
                      output: run.usage.outputTokens,
                    }
                  : null
              }
              replacedKeys={replacedKeys}
            />
          ) : referenceState === 'loading' ? (
            <Skeleton height={240} radius={8} />
          ) : (
            <EmptyState
              compact
              title="Token Flow needs a baseline reference"
              description="This Reflex run has no recorded baseline run to compare with. Run compare on this task to measure one."
            />
          )}
        </Panel>
      </section>

      {reflexRun ? (
        <section id="run-sec-compare" className="run-region" aria-labelledby="run-compare-title">
          <Panel
            title={<span id="run-compare-title">Comparison</span>}
            subtitle="The same task, the same independent verifier"
          >
            {showStopStory ? (
              <FallbackStory stopped={run} fallback={fallback} pending={fallbackPending} />
            ) : null}
            {comparison && reference ? (
              <ComparisonPanel
                comparison={comparison.comparison}
                baseline={reference}
                reflex={run}
              />
            ) : comparisonPending || referenceState === 'loading' ? (
              <Skeleton height={200} radius={8} />
            ) : !showStopStory ? (
              <EmptyState
                compact
                title="No comparison was recorded for this run"
                description="A comparison exists when a Reflex runs beside a baseline reference. Use Run compare above to make one."
              />
            ) : null}
          </Panel>
        </section>
      ) : null}
    </div>
  );
}
