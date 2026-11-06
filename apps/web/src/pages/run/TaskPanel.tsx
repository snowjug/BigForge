import type { RootFailure, TaskDetailDto } from '@bigforge/schemas';
import { ArrowDownToLine, ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useDemoTarget } from '../../demo/useDemo';
import { Button, Chip, Panel, plural, relativeTime } from '../../ui';
import { useNow } from '../../hooks/useNow';
import { useReducedMotion } from '../../theme/prefs';
import { parseLog } from './log';
import { ROLE_LABEL, type ScenarioRole } from './selectors';

export function LogViewer({
  log,
  rootFailure,
}: {
  log: string | null;
  rootFailure: RootFailure | null;
}) {
  const model = useMemo(() => parseLog(log, rootFailure), [log, rootFailure]);
  const scroller = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLLIElement | null>(null);
  const reduced = useReducedMotion();
  const [flash, setFlash] = useState(false);
  useEffect(() => {
    if (!flash) return undefined;
    const timer = window.setTimeout(() => {
      setFlash(false);
    }, 1600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [flash]);

  if (log === null) {
    return <p className="dim">No CI log was stored for this task.</p>;
  }

  const jump = () => {
    const container = scroller.current;
    const line = rootRef.current;
    if (!container || !line) return;
    container.scrollTo({
      top: Math.max(0, line.offsetTop - container.clientHeight / 2 + line.offsetHeight),
      behavior: reduced ? 'auto' : 'smooth',
    });
    setFlash(true);
  };

  const redactionKinds = model.redactions
    .map((entry) => `${entry.kind}${entry.count > 1 ? ` \u00d7${entry.count}` : ''}`)
    .join(', ');
  const firstRoot = model.rootLines[0];

  return (
    <div className="run-logblock" data-testid="task-log">
      <div className="run-logbar">
        <div className="run-logbar__facts">
          <span className="micro">CI log</span>
          <span className="mono dim">ci/last-build.log</span>
          <span className="dim">
            {plural(model.lines.length, 'line')}, {plural(model.errorCount, 'error')}
          </span>
        </div>
        <div className="run-logbar__actions">
          <Chip
            tone="jade"
            variant="outline"
            icon={<ShieldCheck size={12} />}
            title="Secrets are masked before a log is stored, shown to an agent, or sent to a model."
          >
            {model.totalRedactions > 0
              ? `Redactions applied: ${plural(model.totalRedactions, 'secret')} masked (${redactionKinds})`
              : 'Redaction ran: no secrets found'}
          </Chip>
          <Button
            size="sm"
            icon={<ArrowDownToLine size={14} />}
            onClick={jump}
            disabled={firstRoot === undefined}
            {...(firstRoot === undefined
              ? {
                  disabledReason: 'No root cause is recorded yet. Run an agent on this task first.',
                }
              : {})}
          >
            Jump to root cause
          </Button>
        </div>
      </div>
      <div
        className="run-log-scroll"
        ref={scroller}
        role="region"
        aria-label={`CI log, ${model.lines.length} lines`}
        tabIndex={0}
      >
        <ol className="run-log">
          {model.lines.map((line) => (
            <li
              key={line.n}
              ref={line.n === firstRoot ? rootRef : undefined}
              data-level={line.level}
              data-root={line.root ? 'true' : undefined}
              data-consequence={line.consequence ? 'true' : undefined}
              data-flash={line.root && flash ? 'true' : undefined}
              value={line.n}
            >
              <span className="run-log__n num" aria-hidden="true">
                {line.n}
              </span>
              <span className="run-log__text">
                {line.root ? <span className="sr-only">Root cause. </span> : null}
                {line.segments.map((segment, index) =>
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
              </span>
              {line.root ? (
                <span className="run-log__tag" aria-hidden="true">
                  root cause
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
      <p className="run-logkey faint">
        <span className="run-logkey__swatch" data-kind="root" aria-hidden="true" /> the recorded
        root-cause error
        <span className="run-logkey__swatch" data-kind="consequence" aria-hidden="true" /> errors it
        caused
        <span className="run-logkey__swatch" data-kind="redacted" aria-hidden="true" /> a masked
        secret
      </p>
    </div>
  );
}

const STATUS_TONE = {
  received: 'steel',
  solved: 'jade',
  failed: 'crimson',
  observed: 'amber',
} as const;

export function TaskPanel({
  task,
  rootFailure,
}: {
  task: TaskDetailDto;
  rootFailure: RootFailure | null;
}) {
  const target = useDemoTarget(['failure_enters', 'new_task']);
  const now = useNow();
  const fingerprint = task.fingerprint;
  const role = task.scenarioRole as ScenarioRole;
  const roleLabel = ROLE_LABEL[role]?.label ?? task.scenarioRole;
  const signatures = fingerprint.failure.signatures;
  return (
    <section {...target} aria-labelledby="run-task-title" className="run-region">
      <Panel
        title={<span id="run-task-title">Task and CI log</span>}
        subtitle="What arrived, exactly as BigForge captured it"
        actions={
          <>
            <Chip tone="ash" variant="outline" mono>
              {task.scenarioId}
            </Chip>
            <Chip tone={STATUS_TONE[task.status]} variant="soft">
              {task.status}
            </Chip>
          </>
        }
      >
        <div className="run-task">
          <div className="run-task__brief">
            <h3 className="run-task__title">{task.title}</h3>
            <blockquote className="run-task__prompt">{task.prompt}</blockquote>
            <dl className="run-task__facts">
              <div>
                <dt className="micro">Scenario</dt>
                <dd>
                  {roleLabel.toLowerCase()}
                  {task.scenarioRole === 'held_out' ? ', never seen while learning' : ''}
                </dd>
              </div>
              <div>
                <dt className="micro">Toolchain at intake</dt>
                <dd className="mono">forge-ci {task.envVersion}</dd>
              </div>
              <div>
                <dt className="micro">Received</dt>
                <dd title={task.createdAt}>{relativeTime(task.createdAt, now)}</dd>
              </div>
              <div>
                <dt className="micro">Origin</dt>
                <dd>{task.origin}</dd>
              </div>
            </dl>
            <div className="run-task__fp" aria-label="Fingerprint">
              <span className="micro">Fingerprint</span>
              <ul className="run-fp">
                <li>
                  <span className="run-fp__k">intent</span>
                  <span className="mono">{fingerprint.intent.label}</span>
                </li>
                <li>
                  <span className="run-fp__k">toolchain</span>
                  <span className="mono">{fingerprint.toolchain.tool ?? 'unknown'}</span>
                </li>
                <li>
                  <span className="run-fp__k">repo</span>
                  <span>
                    {fingerprint.repo.layout ?? 'unknown'}
                    {fingerprint.repo.workspaceCount
                      ? `, ${fingerprint.repo.workspaceCount} workspaces`
                      : ''}
                  </span>
                </li>
                <li>
                  <span className="run-fp__k">failure</span>
                  <span>
                    {fingerprint.failure.type}
                    {fingerprint.failure.cascading ? ', cascading' : ''}
                  </span>
                </li>
                {signatures.length > 0 ? (
                  <li>
                    <span className="run-fp__k">errors</span>
                    <span className="mono">{signatures.join(' ')}</span>
                  </li>
                ) : null}
              </ul>
            </div>
          </div>
          <LogViewer log={task.originalLog} rootFailure={rootFailure} />
        </div>
      </Panel>
    </section>
  );
}
