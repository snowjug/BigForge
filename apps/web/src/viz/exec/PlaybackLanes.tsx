import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Button,
  Kbd,
  Provenance,
  Summary,
  cx,
  formatMs,
  formatTokens,
  formatUsd,
  plural,
} from '../../ui';
import {
  type Counters,
  type Lane,
  type ModelBlock,
  type StepBlock,
  type ToolBlock,
  activeAt,
  axisTicks,
  countersAt,
  maxModelTokens,
} from './playback';
import { SPEEDS, type PlaybackControls } from './usePlayback';
import './exec.css';

const MODEL_H = 64;

interface SummaryRow {
  id: string;
  lane: 'baseline' | 'reflex';
  type: string;
  what: string;
  start: number;
  end: number;
  tokens: number | null;
}

const tickLabel = (ms: number): string =>
  ms === 0
    ? '0'
    : ms < 1000
      ? `${Math.round(ms)} ms`
      : `${Math.round(ms / 10) / 100} s`.replace(/\.0+ s$/, ' s');

const pctOf = (value: number, duration: number): string => `${(value / duration) * 100}%`;

function phase(start: number, end: number, t: number): 'future' | 'active' | 'past' {
  if (t < start) return 'future';
  return t < end ? 'active' : 'past';
}

function narrate(lane: Lane, t: number): string {
  const counters = countersAt(lane, t);
  if (counters.finished) return `finished at ${formatMs(lane.end)}`;
  const work = activeAt(lane, t);
  if (!work) return t <= 0 ? 'about to start' : 'between operations';
  if (work.type === 'model') {
    const index = lane.models.indexOf(work.block) + 1;
    const purpose = work.block.purpose ? `, ${work.block.purpose.replace(/_/g, ' ')}` : '';
    return `model call ${index} of ${lane.models.length}${purpose} (${formatTokens(work.block.tokens)} tokens, synthetic)`;
  }
  if (work.type === 'step') {
    return `step ${work.block.stepId.replace(/_/g, ' ')}${work.block.status === 'escalated' ? ', crossing its uncertainty boundary' : ', local, no model call'}`;
  }
  return `running ${work.block.label} (measured)`;
}

export function describePlayback(lanes: readonly Lane[], t: number): string {
  const parts = lanes.map((lane) => {
    const counters = countersAt(lane, t);
    const who = lane.side === 'baseline' ? 'Baseline' : 'Reflex';
    return `${who}: ${plural(counters.modelCalls, 'model call')}, ${formatTokens(counters.totalTokens)} tokens, ${narrate(lane, t)}`;
  });
  return `At ${formatMs(t)} of virtual time. ${parts.join('. ')}.`;
}

function ModelBar({
  block,
  index,
  total,
  maxTokens,
  duration,
  t,
}: {
  block: ModelBlock;
  index: number;
  total: number;
  maxTokens: number;
  duration: number;
  t: number;
}) {
  const height = Math.max(3, (block.tokens / Math.max(1, maxTokens)) * (MODEL_H - 8));
  const title = `Model call ${index} of ${total}${block.purpose ? `: ${block.purpose.replace(/_/g, ' ')}` : ''}\n${formatTokens(block.tokens)} tokens (${block.tokenProvenance}), ${formatTokens(block.cachedInputTokens)} of the input cached\n${formatMs(block.latencyMs)} (${block.latencyProvenance} latency)`;
  return (
    <span
      className="ex-block ex-block--model"
      data-state={phase(block.start, block.end, t)}
      data-boundary={block.boundaryStepId ? 'true' : undefined}
      style={{
        left: pctOf(block.start, duration),
        width: pctOf(block.end - block.start, duration),
        height,
      }}
      title={title}
    />
  );
}

function ToolBar({ block, duration, t }: { block: ToolBlock; duration: number; t: number }) {
  const title = `${block.tool}: ${block.label}\n${block.status === 'blocked' ? `Blocked: ${block.blockedReason ?? 'safety policy'}` : `${formatMs(block.durationMs)} (measured)${block.exitCode !== null ? `, exit ${block.exitCode}` : ''}`}`;
  return (
    <span
      className="ex-block ex-block--tool"
      data-state={phase(block.start, Math.max(block.end, block.start + 1), t)}
      data-status={block.status}
      style={{
        left: pctOf(block.start, duration),
        width: pctOf(block.end - block.start, duration),
      }}
      title={title}
    />
  );
}

function StepBar({ block, duration, t }: { block: StepBlock; duration: number; t: number }) {
  const title = `Step ${block.stepId}: ${block.summary}\n${block.executor === 'local' ? 'Local, 0 model calls' : 'Crossed its uncertainty boundary'} \u00b7 ${formatMs(block.durationMs)}`;
  return (
    <span
      className="ex-block ex-block--step"
      data-state={phase(block.start, Math.max(block.end, block.start + 1), t)}
      data-status={block.status}
      style={{
        left: pctOf(block.start, duration),
        width: pctOf(block.end - block.start, duration),
      }}
      title={title}
    >
      <span className="ex-block__label">{block.stepId}</span>
    </span>
  );
}

function CounterCell({
  counters,
  field,
  lane,
}: {
  counters: Counters;
  field: 'calls' | 'tokens' | 'cost' | 'commands' | 'elapsed';
  lane: Lane;
}): ReactNode {
  switch (field) {
    case 'calls':
      return counters.modelCalls;
    case 'tokens':
      return formatTokens(counters.totalTokens);
    case 'cost':
      return formatUsd(counters.costUsd);
    case 'commands':
      return counters.commands;
    case 'elapsed':
      return (
        <>
          {formatMs(counters.elapsedMs)}
          {counters.finished ? <span className="ex-done"> finished</span> : null}
          <span className="sr-only"> {lane.side}</span>
        </>
      );
  }
}

export interface PlaybackLanesProps {
  baseline: Lane | null;
  reflex: Lane | null;
  controls: PlaybackControls;
  baselineLabel?: string;
  reflexLabel?: string;
  /** Why there is no baseline lane to compare with. */
  noBaselineNote?: ReactNode;
}

export function PlaybackLanes({
  baseline,
  reflex,
  controls,
  baselineLabel,
  reflexLabel,
  noBaselineNote,
}: PlaybackLanesProps) {
  const { duration, t } = controls;
  const lanes = useMemo(
    () => [baseline, reflex].filter((lane): lane is Lane => lane !== null),
    [baseline, reflex],
  );
  const maxTokens = useMemo(() => maxModelTokens(lanes), [lanes]);
  const ticks = useMemo(() => axisTicks(duration), [duration]);
  const [zoom, setZoom] = useState(1);
  const scroller = useRef<HTMLDivElement | null>(null);
  const track = useRef<HTMLDivElement | null>(null);
  const hintId = useId();
  const reflexEnd = reflex?.end ?? 0;
  const focusZoom =
    reflex && baseline && reflexEnd > 0
      ? Math.max(1, Math.min(16, duration / (reflexEnd * 1.08)))
      : 1;
  const zoomed = zoom > 1.01;

  // Keep the playhead in view while it moves across a zoomed axis.
  useEffect(() => {
    const element = scroller.current;
    if (!element || !zoomed) return;
    const head = (t / duration) * element.scrollWidth;
    if (head < element.scrollLeft + 24 || head > element.scrollLeft + element.clientWidth - 24) {
      element.scrollLeft = Math.max(0, head - element.clientWidth * 0.4);
    }
  }, [t, duration, zoomed]);

  const description = describePlayback(lanes, t);
  // The live region only changes while paused or scrubbing, so playback does not flood a screen reader.
  const [announced, setAnnounced] = useState(description);
  if (!controls.playing && announced !== description) setAnnounced(description);

  const seekFromPointer = (event: PointerEvent<HTMLElement>) => {
    const element = track.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return;
    controls.seek(((event.clientX - rect.left) / rect.width) * duration);
  };
  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.currentTarget.setPointerCapture(event.pointerId);
    seekFromPointer(event);
  };
  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    if (event.buttons === 1) seekFromPointer(event);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    switch (event.key) {
      case ' ':
        if (!controls.stepOnly) controls.toggle();
        break;
      case 'ArrowRight':
      case 'ArrowUp':
        controls.stepForward();
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        controls.stepBack();
        break;
      case 'Home':
        controls.toStart();
        break;
      case 'End':
        controls.toEnd();
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const laneRows = (lane: Lane) => {
    const isReflex = lane.side === 'reflex';
    return (
      <>
        {isReflex ? (
          <div className="ex-row ex-row--steps" aria-hidden="true">
            {lane.steps.map((block) => (
              <StepBar key={block.id} block={block} duration={duration} t={t} />
            ))}
          </div>
        ) : null}
        <div className="ex-row ex-row--model" aria-hidden="true">
          {lane.models.map((block, index) => (
            <ModelBar
              key={block.id}
              block={block}
              index={index + 1}
              total={lane.models.length}
              maxTokens={maxTokens}
              duration={duration}
              t={t}
            />
          ))}
          {lane.models.length === 0 ? <span className="ex-row__none">no model calls</span> : null}
        </div>
        <div className="ex-row ex-row--tools" aria-hidden="true">
          {lane.tools.map((block) => (
            <ToolBar key={block.id} block={block} duration={duration} t={t} />
          ))}
        </div>
      </>
    );
  };

  const laneLabel = (lane: Lane) => {
    const isReflex = lane.side === 'reflex';
    const title = isReflex ? (reflexLabel ?? lane.label) : (baselineLabel ?? lane.label);
    return (
      <div className="ex-lane-label" data-side={lane.side}>
        <p className="ex-lane-label__title">{isReflex ? 'BigForge Reflex' : 'Baseline agent'}</p>
        <p className="ex-lane-label__sub mono">{title}</p>
        <div className="ex-lane-label__rows" aria-hidden="true">
          {isReflex ? <span className="ex-row-label ex-row-label--steps">Local steps</span> : null}
          <span className="ex-row-label ex-row-label--model">Model calls</span>
          <span className="ex-row-label ex-row-label--tools">Commands</span>
        </div>
      </div>
    );
  };

  const summaryRows: SummaryRow[] = lanes
    .flatMap((lane): SummaryRow[] => [
      ...lane.steps.map((block) => ({
        id: block.id,
        lane: lane.side,
        type: 'Step',
        what: `${block.stepId} (${block.status})`,
        start: block.start,
        end: block.end,
        tokens: null,
      })),
      ...lane.models.map((block) => ({
        id: block.id,
        lane: lane.side,
        type: block.boundaryStepId ? 'Boundary call' : 'Model call',
        what: (block.purpose ?? block.model).replace(/_/g, ' '),
        start: block.start,
        end: block.end,
        tokens: block.tokens,
      })),
      ...lane.tools.map((block) => ({
        id: block.id,
        lane: lane.side,
        type: block.status === 'blocked' ? 'Blocked command' : 'Command',
        what: block.label,
        start: block.start,
        end: block.end,
        tokens: null,
      })),
    ])
    .sort((a, b) => a.start - b.start);

  const finals = lanes.map((lane) => ({ lane, counters: countersAt(lane, lane.end) }));
  const finalBaseline = finals.find((entry) => entry.lane.side === 'baseline');
  const finalReflex = finals.find((entry) => entry.lane.side === 'reflex');

  return (
    <div className="ex-playback" data-testid="playback">
      <div className="ex-controls">
        <div className="ex-controls__transport" role="group" aria-label="Playback controls">
          <Button
            size="sm"
            variant="forge"
            icon={controls.playing ? <Pause size={14} /> : <Play size={14} />}
            onClick={controls.toggle}
            disabled={controls.stepOnly}
            {...(controls.stepOnly
              ? {
                  disabledReason:
                    'Auto-play is off because reduced motion is on. Step through the events instead.',
                }
              : {})}
            data-testid="playback-play"
            aria-label={
              controls.playing ? 'Pause playback' : t >= duration ? 'Replay from the start' : 'Play'
            }
          >
            {controls.playing ? 'Pause' : t >= duration ? 'Replay' : 'Play'}
          </Button>
          <Button
            size="sm"
            icon={<SkipBack size={14} />}
            aria-label="Jump to the start"
            onClick={controls.toStart}
          />
          <Button
            size="sm"
            icon={<ChevronLeft size={14} />}
            aria-label="Step back to the previous event"
            onClick={controls.stepBack}
            data-testid="playback-step-back"
          />
          <Button
            size="sm"
            icon={<ChevronRight size={14} />}
            aria-label="Step forward to the next event"
            onClick={controls.stepForward}
            data-testid="playback-step"
          />
          <Button
            size="sm"
            icon={<SkipForward size={14} />}
            aria-label="Jump to the end"
            onClick={controls.toEnd}
          />
        </div>
        <div className="ex-controls__group" role="group" aria-label="Playback speed">
          <span className="micro">Speed</span>
          {SPEEDS.map((speed) => (
            <button
              key={speed}
              type="button"
              className="ex-chip-btn"
              aria-pressed={controls.speed === speed}
              disabled={controls.stepOnly}
              onClick={() => {
                controls.setSpeed(speed);
              }}
            >
              {speed}&times;
            </button>
          ))}
        </div>
        <div className="ex-controls__group" role="group" aria-label="Zoom the time axis">
          <span className="micro">Zoom</span>
          <button
            type="button"
            className="ex-chip-btn"
            aria-pressed={zoom === 1}
            onClick={() => {
              setZoom(1);
            }}
          >
            Fit run
          </button>
          {focusZoom > 1.5 ? (
            <button
              type="button"
              className="ex-chip-btn"
              aria-pressed={Math.abs(zoom - focusZoom) < 0.01}
              onClick={() => {
                setZoom(focusZoom);
                if (scroller.current) scroller.current.scrollLeft = 0;
              }}
            >
              Reflex run
            </button>
          ) : null}
          <Button
            size="sm"
            icon={<ZoomOut size={14} />}
            aria-label="Zoom out"
            disabled={zoom <= 1}
            onClick={() => {
              setZoom((value) => Math.max(1, value / 1.6));
            }}
          />
          <Button
            size="sm"
            icon={<ZoomIn size={14} />}
            aria-label="Zoom in"
            disabled={zoom >= 16}
            onClick={() => {
              setZoom((value) => Math.min(16, value * 1.6));
            }}
          />
        </div>
      </div>

      <div className="ex-axis-note">
        <span className="micro">Virtual time</span>
        <span>simulated model latency + measured local time</span>
        <Provenance kind={['simulated', 'measured']} metric="model_latency" />
        <p className="ex-controls__time num" aria-hidden="true">
          <span>{formatMs(t)}</span> <span className="faint">of {formatMs(duration)}</span>
        </p>
      </div>

      <div
        className="ex-stage"
        role="group"
        aria-label="Baseline and Reflex execution on one shared time axis"
        data-lanes={lanes.length}
      >
        <div className="ex-labels">
          <div className="ex-axis-label" aria-hidden="true" />
          {lanes.map((lane) => (
            <div
              key={lane.side}
              className="ex-lane-label-wrap"
              data-side={lane.side}
              data-testid={`exec-lane-label-${lane.side}`}
            >
              {laneLabel(lane)}
            </div>
          ))}
        </div>
        <div className="ex-scroll" ref={scroller}>
          <div
            className="ex-track"
            ref={track}
            style={{ width: `calc(${zoom} * (100% - 14px))` }}
            data-zoomed={zoomed ? 'true' : undefined}
          >
            <div
              className="ex-axis"
              role="slider"
              tabIndex={0}
              aria-label="Playback position on the shared time axis"
              aria-valuemin={0}
              aria-valuemax={Math.round(duration)}
              aria-valuenow={Math.round(t)}
              aria-valuetext={description}
              aria-describedby={hintId}
              onKeyDown={onKeyDown}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              data-testid="playback-scrubber"
            >
              {ticks.map((tick) => (
                <span key={tick} className="ex-tick" style={{ left: pctOf(tick, duration) }}>
                  <span className="ex-tick__label num">{tickLabel(tick)}</span>
                </span>
              ))}
              <span
                className="ex-axis__head"
                style={{ left: pctOf(t, duration) }}
                aria-hidden="true"
              />
            </div>
            <div className="ex-grid" aria-hidden="true">
              {ticks.map((tick) => (
                <span
                  key={tick}
                  className="ex-grid__line"
                  style={{ left: pctOf(tick, duration) }}
                />
              ))}
            </div>
            {lanes.map((lane) => (
              <div
                key={lane.side}
                className="ex-lane"
                data-side={lane.side}
                data-testid={`exec-lane-${lane.side}`}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
              >
                {laneRows(lane)}
                {t >= lane.end && lane.end < duration ? (
                  <span
                    className="ex-lane__end"
                    style={{ left: pctOf(lane.end, duration) }}
                    aria-hidden="true"
                  >
                    <span>done {formatMs(lane.end)}</span>
                  </span>
                ) : null}
              </div>
            ))}
            <span className="ex-playhead" style={{ left: pctOf(t, duration) }} aria-hidden="true" />
          </div>
        </div>
      </div>
      <p id={hintId} className="ex-hint">
        <Kbd>Space</Kbd> plays or pauses, <Kbd>&larr;</Kbd> <Kbd>&rarr;</Kbd> step between events,{' '}
        <Kbd>Home</Kbd> <Kbd>End</Kbd> jump to the ends. Click a lane to move the playhead.
      </p>

      <div className="ex-now" aria-hidden="true">
        {description}
      </div>
      <div className="sr-only" aria-live="polite" role="status">
        {announced}
      </div>

      <table
        className={cx('ex-counters', lanes.length === 1 && 'ex-counters--single')}
        aria-label="Live counters at the playhead"
      >
        <thead>
          <tr>
            <th scope="col" />
            {baseline ? (
              <th scope="col" data-side="baseline">
                Baseline agent
              </th>
            ) : null}
            {reflex ? (
              <th scope="col" data-side="reflex">
                BigForge Reflex
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {(
            [
              ['calls', 'Model calls', ['synthetic'], 'model_calls'],
              ['tokens', 'Tokens', ['synthetic'], 'tokens_per_task'],
              ['cost', 'Cost', ['synthetic', 'estimated'], 'cost_usd'],
              ['commands', 'Commands', ['measured'], 'commands'],
              ['elapsed', 'Elapsed', ['simulated', 'measured'], 'model_latency'],
            ] as const
          ).map(([field, label, provenance, metric]) => (
            <tr key={field}>
              <th scope="row">
                <span>{label}</span>
                <Provenance kind={[...provenance]} metric={metric} />
                {field === 'cost' ? (
                  <span className="ex-counters__note">split by token share</span>
                ) : null}
              </th>
              {baseline ? (
                <td className="num" data-side="baseline">
                  <CounterCell counters={countersAt(baseline, t)} field={field} lane={baseline} />
                </td>
              ) : null}
              {reflex ? (
                <td className="num" data-side="reflex">
                  <CounterCell counters={countersAt(reflex, t)} field={field} lane={reflex} />
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>

      {baseline && reflex && finalBaseline && finalReflex ? (
        <p className="ex-takeaway">
          The Reflex finished in <strong>{formatMs(reflex.end)}</strong> with{' '}
          <strong>{plural(finalReflex.counters.modelCalls, 'model call')}</strong> and{' '}
          <strong>{formatTokens(finalReflex.counters.totalTokens)} tokens</strong>. The baseline
          needed <strong>{formatMs(baseline.end)}</strong>,{' '}
          <strong>{plural(finalBaseline.counters.modelCalls, 'model call')}</strong> and{' '}
          <strong>{formatTokens(finalBaseline.counters.totalTokens)} tokens</strong>. Tokens are
          synthetic, latency is simulated.
        </p>
      ) : noBaselineNote ? (
        <p className="ex-takeaway">{noBaselineNote}</p>
      ) : null}

      <Summary
        description="Every model call, step and command of each lane on the shared virtual time axis, in start order."
        caption="Execution events by lane"
        columns={[
          {
            id: 'lane',
            header: 'Lane',
            cell: (row) => (row.lane === 'baseline' ? 'Baseline' : 'Reflex'),
          },
          { id: 'type', header: 'Kind', cell: (row) => row.type },
          { id: 'what', header: 'What', cell: (row) => row.what, mono: true },
          {
            id: 'start',
            header: 'Start (virtual)',
            cell: (row) => formatMs(row.start),
            align: 'end',
            mono: true,
          },
          {
            id: 'end',
            header: 'End (virtual)',
            cell: (row) => formatMs(row.end),
            align: 'end',
            mono: true,
          },
          {
            id: 'tokens',
            header: 'Tokens (synthetic)',
            cell: (row) => (row.tokens === null ? '\u2014' : formatTokens(row.tokens)),
            align: 'end',
            mono: true,
          },
        ]}
        rows={summaryRows}
        getRowId={(row) => row.id}
      />
    </div>
  );
}
