import type { TraceEvent } from '@bigforge/schemas';
import {
  BadgeCheck,
  Brain,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  GitFork,
  ShieldAlert,
  ShieldCheck,
  StickyNote,
  Terminal,
  Workflow,
} from 'lucide-react';
import { type KeyboardEvent, type ReactNode, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { runPath } from '../../routes';
import {
  Button,
  Chip,
  Drawer,
  Provenance,
  VerificationChip,
  cx,
  formatMs,
  formatPct,
  formatTokens,
  plural,
} from '../../ui';
import { splitRedactions } from '../run/log';
import {
  CATEGORY_LABEL,
  CATEGORY_ORDER,
  type EventCategory,
  type TimelineRow,
  barGeometry,
  categoryCounts,
  filterRows,
  timelineSpan,
} from './timeline';

const ICON: Record<EventCategory, ReactNode> = {
  model: <Brain size={14} aria-hidden="true" />,
  tool: <Terminal size={14} aria-hidden="true" />,
  step: <Workflow size={14} aria-hidden="true" />,
  decision: <GitFork size={14} aria-hidden="true" />,
  safety: <ShieldAlert size={14} aria-hidden="true" />,
  note: <StickyNote size={14} aria-hidden="true" />,
  boundary: <Crosshair size={14} aria-hidden="true" />,
  verification: <BadgeCheck size={14} aria-hidden="true" />,
};

function metricOf(row: TimelineRow): ReactNode {
  if (row.payload.type === 'verification') return row.payload.report.status;
  const event = row.payload.event;
  switch (event.kind) {
    case 'model_call':
      return `${formatTokens(event.usage.inputTokens + event.usage.outputTokens)} tok`;
    case 'tool_call':
      return event.status === 'blocked' ? 'blocked' : formatMs(event.durationMs);
    case 'step':
      return formatMs(event.durationMs);
    case 'boundary':
      return `${formatTokens(event.contextTokensBefore)} \u2192 ${formatTokens(event.contextTokensAfter)} tok`;
    case 'decision':
      return event.confidence !== undefined ? formatPct(event.confidence, { digits: 0 }) : '';
    case 'safety':
      return event.blocked ? 'blocked' : 'allowed';
    case 'note':
      return '';
  }
}

export interface TraceTimelineProps {
  rows: readonly TimelineRow[];
  selectedKey: string | null;
  onSelect: (key: string | null) => void;
}

export function TraceTimeline({ rows, selectedKey, onSelect }: TraceTimelineProps) {
  const [hidden, setHidden] = useState<ReadonlySet<EventCategory>>(new Set());
  const counts = useMemo(() => categoryCounts(rows), [rows]);
  const visible = useMemo(() => filterRows(rows, hidden), [rows, hidden]);
  const span = useMemo(() => timelineSpan(rows), [rows]);
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [focusKey, setFocusKey] = useState<string | null>(null);
  const tabbable =
    focusKey && visible.some((row) => row.key === focusKey) ? focusKey : (visible[0]?.key ?? null);

  const toggle = (category: EventCategory) => {
    setHidden((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  const move = (from: string, delta: number | 'first' | 'last') => {
    const index = visible.findIndex((row) => row.key === from);
    const target =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? visible.length - 1
          : Math.max(0, Math.min(visible.length - 1, index + delta));
    const row = visible[target];
    if (!row) return;
    setFocusKey(row.key);
    refs.current.get(row.key)?.focus();
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, key: string) => {
    switch (event.key) {
      case 'ArrowDown':
        move(key, 1);
        break;
      case 'ArrowUp':
        move(key, -1);
        break;
      case 'Home':
        move(key, 'first');
        break;
      case 'End':
        move(key, 'last');
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  return (
    <div className="trace-timeline-block">
      <div className="trace-filterbar" role="group" aria-label="Show event types">
        {CATEGORY_ORDER.filter((category) => counts.get(category)).map((category) => {
          const on = !hidden.has(category);
          return (
            <button
              key={category}
              type="button"
              className="trace-filterchip"
              aria-pressed={on}
              onClick={() => {
                toggle(category);
              }}
            >
              {ICON[category]}
              <span>{CATEGORY_LABEL[category]}</span>
              <span className="num trace-filterchip__n">{counts.get(category)}</span>
            </button>
          );
        })}
        <span className="trace-filterbar__note faint" aria-live="polite">
          {visible.length} of {plural(rows.length, 'event')} shown
        </span>
      </div>

      <div
        className="trace-timeline"
        data-testid="trace-timeline"
        role="list"
        aria-label="Trace timeline"
      >
        <div className="trace-timeline__head" aria-hidden="true">
          <span>Time (virtual)</span>
          <span />
          <span>Event</span>
          <span>0 to {formatMs(span)}</span>
          <span className="trace-timeline__metric">Tokens or time</span>
        </div>
        {visible.map((row) => {
          const geometry = barGeometry(row, span);
          const event = row.payload.type === 'event' ? row.payload.event : null;
          return (
            <div role="listitem" key={row.key} className="trace-rowwrap" data-depth={row.depth}>
              <button
                ref={(element) => {
                  if (element) refs.current.set(row.key, element);
                  else refs.current.delete(row.key);
                }}
                type="button"
                className={cx('trace-row', selectedKey === row.key && 'is-selected')}
                data-testid="trace-event"
                data-category={row.category}
                data-tone={row.tone}
                data-failed={row.failed ? 'true' : undefined}
                aria-haspopup="dialog"
                tabIndex={tabbable === row.key ? 0 : -1}
                onFocus={() => {
                  setFocusKey(row.key);
                }}
                onKeyDown={(keyEvent) => {
                  onKeyDown(keyEvent, row.key);
                }}
                onClick={() => {
                  onSelect(row.key);
                }}
              >
                <span className="trace-row__time num">{formatMs(row.at)}</span>
                <span className="trace-row__icon">{ICON[row.category]}</span>
                <span className="trace-row__main">
                  <span className="trace-row__title">{row.title}</span>
                  <span className="trace-row__detail mono">{row.detail}</span>
                  <span className="trace-row__chips">
                    {row.blocked ? (
                      <Chip
                        tone="crimson"
                        variant="soft"
                        size="sm"
                        icon={<ShieldAlert size={11} />}
                      >
                        blocked
                      </Chip>
                    ) : null}
                    {event && event.kind === 'tool_call' && event.status === 'error' ? (
                      <Chip tone="amber" variant="outline" size="sm">
                        exit {event.exitCode ?? '?'}
                      </Chip>
                    ) : null}
                    {row.redactions > 0 ? (
                      <Chip
                        tone="amber"
                        variant="outline"
                        size="sm"
                        icon={<ShieldCheck size={11} />}
                      >
                        {row.redactions} redacted
                      </Chip>
                    ) : null}
                    {event && event.kind === 'model_call' && event.boundaryStepId ? (
                      <Chip tone="molten" variant="outline" size="sm">
                        boundary
                      </Chip>
                    ) : null}
                  </span>
                </span>
                <span className="trace-row__span" aria-hidden="true">
                  <span
                    className="trace-row__bar"
                    style={{ left: `${geometry.left * 100}%`, width: `${geometry.width * 100}%` }}
                  />
                </span>
                <span className="trace-row__metric num mono">{metricOf(row)}</span>
              </button>
            </div>
          );
        })}
        {visible.length === 0 ? (
          <p className="trace-timeline__empty dim">
            Every event type is hidden. Turn one back on above.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Redacted({ text }: { text: string }) {
  return (
    <>
      {splitRedactions(text).map((segment, index) =>
        segment.redacted ? (
          <mark
            key={index}
            className="run-log__redacted"
            title={`Secret redacted before storage (${segment.redacted})`}
          >
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function Pre({ text, label }: { text: string; label: string }) {
  return (
    <pre className="trace-pre mono" tabIndex={0} aria-label={label}>
      <Redacted text={text} />
    </pre>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="micro">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function EventBody({ event }: { event: TraceEvent }) {
  switch (event.kind) {
    case 'model_call':
      return (
        <>
          <dl className="trace-facts">
            <Fact label="Purpose">
              {event.purpose ? event.purpose.replace(/_/g, ' ') : 'not labelled'}
            </Fact>
            <Fact label="Model">
              <span className="mono">{event.provider.model}</span>
              <span className="faint">
                {' '}
                ·{' '}
                {event.provider.mode === 'deterministic'
                  ? 'deterministic provider (synthetic)'
                  : 'live provider'}
              </span>
            </Fact>
            <Fact label="Input tokens">
              <span className="num">{formatTokens(event.usage.inputTokens)}</span>{' '}
              <span className="faint">({formatTokens(event.usage.cachedInputTokens)} cached)</span>{' '}
              <Provenance kind={event.usage.provenance} metric="tokens_per_task" />
            </Fact>
            <Fact label="Output tokens">
              <span className="num">{formatTokens(event.usage.outputTokens)}</span>{' '}
              <Provenance kind={event.usage.provenance} metric="tokens_per_task" />
            </Fact>
            <Fact label="Latency">
              <span className="num">{formatMs(event.latency.ms)}</span>{' '}
              <Provenance kind={event.latency.provenance} metric="model_latency" />
            </Fact>
            <Fact label="Context">{plural(event.contextMessages, 'message')}</Fact>
            {event.boundaryStepId ? (
              <Fact label="Crossed the boundary of step">{event.boundaryStepId}</Fact>
            ) : null}
          </dl>
          <h3 className="trace-h">Response</h3>
          <Pre text={event.responsePreview} label="Model response preview" />
          {event.toolCalls.length > 0 ? (
            <>
              <h3 className="trace-h">Requested calls</h3>
              <Pre
                text={JSON.stringify(event.toolCalls, null, 2)}
                label="Tool calls the model requested"
              />
            </>
          ) : null}
        </>
      );
    case 'tool_call':
      return (
        <>
          <dl className="trace-facts">
            <Fact label="Tool">
              <span className="mono">{event.tool}</span>
            </Fact>
            <Fact label="Status">
              {event.status === 'blocked' ? (
                <Chip tone="crimson" variant="soft" size="sm" icon={<ShieldAlert size={11} />}>
                  blocked, never executed
                </Chip>
              ) : event.status === 'error' ? (
                <Chip tone="amber" variant="outline" size="sm">
                  failed, exit {event.exitCode ?? '?'}
                </Chip>
              ) : (
                <Chip tone="jade" variant="outline" size="sm">
                  ok{event.exitCode !== null ? `, exit ${event.exitCode}` : ''}
                </Chip>
              )}
            </Fact>
            <Fact label="Duration">
              <span className="num">{formatMs(event.durationMs)}</span>{' '}
              <Provenance kind={event.durationProvenance} metric="local_time" />
            </Fact>
            <Fact label="Ran as">
              {event.spawned ? 'a sandboxed process' : 'an in-process file operation'}
            </Fact>
            <Fact label="Output">{event.outputBytes.toLocaleString('en-US')} bytes</Fact>
            {event.purpose ? <Fact label="Purpose">{event.purpose.replace(/_/g, ' ')}</Fact> : null}
          </dl>
          {event.blockedReason ? (
            <p className="trace-callout" data-tone="crimson">
              <strong>Blocked:</strong> {event.blockedReason}
            </p>
          ) : null}
          <h3 className="trace-h">Arguments</h3>
          <Pre text={JSON.stringify(event.args, null, 2)} label="Tool call arguments" />
          <h3 className="trace-h">Output preview</h3>
          <Pre text={event.outputPreview || '(empty)'} label="Tool call output preview" />
        </>
      );
    case 'step':
      return (
        <dl className="trace-facts">
          <Fact label="Step">
            <span className="mono">{event.stepId}</span>
          </Fact>
          <Fact label="Operator">
            <span className="mono">{event.operator}</span>
          </Fact>
          <Fact label="Executor">
            {event.executor === 'local'
              ? 'local, no model call'
              : 'a model, through the Token Firewall'}
          </Fact>
          <Fact label="Status">{event.status}</Fact>
          <Fact label="Duration">
            <span className="num">{formatMs(event.durationMs)}</span>{' '}
            <Provenance
              kind={event.executor === 'local' ? 'measured' : ['simulated', 'measured']}
              metric="local_time"
            />
          </Fact>
          {event.confidence !== undefined ? (
            <Fact label="Confidence">{formatPct(event.confidence, { digits: 0 })}</Fact>
          ) : null}
          <Fact label="Summary">{event.summary}</Fact>
        </dl>
      );
    case 'decision':
      return (
        <>
          <dl className="trace-facts">
            <Fact label="Intent">{event.intent.replace(/_/g, ' ')}</Fact>
            <Fact label="Decided by">
              {event.by === 'model' ? 'the model' : `operator ${event.operator ?? ''}`}
            </Fact>
            {event.confidence !== undefined ? (
              <Fact label="Confidence">{formatPct(event.confidence, { digits: 0 })}</Fact>
            ) : null}
          </dl>
          <h3 className="trace-h">Output</h3>
          <Pre text={JSON.stringify(event.output, null, 2)} label="Decision output" />
        </>
      );
    case 'safety':
      return (
        <>
          <dl className="trace-facts">
            <Fact label="Action">
              <span className="mono">{event.action}</span>
            </Fact>
            <Fact label="Result">
              {event.blocked ? (
                <Chip tone="crimson" variant="soft" size="sm" icon={<ShieldAlert size={11} />}>
                  blocked
                </Chip>
              ) : (
                <Chip tone="jade" variant="outline" size="sm">
                  allowed
                </Chip>
              )}
            </Fact>
            <Fact label="Rule">
              <span className="mono">{event.rule}</span>
            </Fact>
            <Fact label="Reason">{event.reason}</Fact>
          </dl>
          {event.blocked ? (
            <p className="trace-callout">
              This behaviour is recorded as evidence of what the agent tried. It never ran, and the
              compiler never turns a blocked call into a Reflex step.
            </p>
          ) : null}
        </>
      );
    case 'note':
      return (
        <dl className="trace-facts">
          <Fact label="Level">{event.level}</Fact>
          <Fact label="Message">{event.message}</Fact>
        </dl>
      );
    case 'boundary':
      return (
        <>
          <dl className="trace-facts">
            <Fact label="Step">
              <span className="mono">{event.stepId}</span>
            </Fact>
            <Fact label="Question">{event.question}</Fact>
            <Fact label="Why it stopped to ask">{event.reason}</Fact>
            <Fact label="Firewall verdict path">
              <span className="trace-verdicts">
                {event.verdict.split('>').map((verdict) => (
                  <Chip key={verdict} tone="molten" variant="outline" size="sm" mono>
                    {verdict.trim()}
                  </Chip>
                ))}
              </span>
            </Fact>
            <Fact label="Evidence">
              <span className="num">
                {formatTokens(event.contextTokensBefore)} tokens observed,{' '}
                {formatTokens(event.contextTokensAfter)} sent
              </span>{' '}
              <Provenance kind="synthetic" metric="context_reduction" />
            </Fact>
          </dl>
        </>
      );
  }
}

export interface EventInspectorProps {
  row: TimelineRow | null;
  runId: string;
  taskId: string;
  onClose: () => void;
  onStep: (delta: -1 | 1) => void;
  hasPrevious: boolean;
  hasNext: boolean;
}

export function EventInspector({
  row,
  runId,
  taskId,
  onClose,
  onStep,
  hasPrevious,
  hasNext,
}: EventInspectorProps) {
  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      modal={false}
      width={520}
      title={
        row
          ? `${row.title}: ${row.detail.length > 60 ? `${row.detail.slice(0, 57)}...` : row.detail}`
          : 'Event'
      }
      description={
        row
          ? `${CATEGORY_LABEL[row.category]} at ${formatMs(row.at)} on the virtual clock (simulated model latency plus measured local time)`
          : undefined
      }
      footer={
        <div className="trace-inspector__foot">
          <Button
            size="sm"
            icon={<ChevronLeft size={14} />}
            disabled={!hasPrevious}
            onClick={() => {
              onStep(-1);
            }}
          >
            Previous
          </Button>
          <Button
            size="sm"
            iconRight={<ChevronRight size={14} />}
            disabled={!hasNext}
            onClick={() => {
              onStep(1);
            }}
          >
            Next
          </Button>
          <Link className="trace-inspector__link" to={runPath({ task: taskId, run: runId })}>
            Open in the Run Console
          </Link>
        </div>
      }
    >
      {row ? (
        row.payload.type === 'verification' ? (
          <div className="trace-verification">
            <p className="trace-verification__head">
              <VerificationChip status={row.payload.report.status} />{' '}
              <span className="faint">{row.payload.report.verifier}</span>
            </p>
            <ul className="trace-rules">
              {row.payload.report.rules.map((rule) => (
                <li key={rule.id} data-status={rule.status}>
                  <p className="trace-rules__label">
                    {rule.label}: <strong>{rule.status}</strong>
                  </p>
                  <p className="dim">{rule.evidence}</p>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <div className="trace-inspector__body" data-testid="trace-inspector">
            <EventBody event={row.payload.event} />
          </div>
        )
      ) : null}
    </Drawer>
  );
}
