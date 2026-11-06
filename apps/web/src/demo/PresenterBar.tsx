import {
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CircleCheck,
  Maximize2,
  Minimize2,
  RotateCcw,
  ShieldAlert,
  UserRoundCheck,
  X,
} from 'lucide-react';
import { ApiError, errorMessage } from '../api/client';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Button, Chip, Kbd, Meter, ROLE_META, Spinner, Tooltip, cx } from '../ui';
import { groupScenes, pendingBefore } from './scenes';
import { useDemo } from './useDemo';

const KIND_CHIP = {
  action: { label: 'Action', tone: 'ember' },
  view: { label: 'View', tone: 'steel' },
  human: { label: 'Human decision', tone: 'molten' },
} as const;

function firstName(displayName: string): string {
  return displayName.split(' ')[0] ?? displayName;
}

function ScenePips() {
  const demo = useDemo();
  const groups = groupScenes(demo.steps);
  return (
    <ol className="bf-scenes" aria-label="Demo progress by scene">
      {groups.map((group) => (
        <li key={group.name} className="bf-scene" style={{ flexGrow: group.steps.length }}>
          <button
            type="button"
            className="bf-scene__label"
            disabled={demo.busy}
            aria-label={`${group.name}, steps ${group.first} to ${group.last}, ${group.doneCount} done. Go to step ${group.first}`}
            onClick={() => {
              void demo.goto(group.first);
            }}
          >
            <span className="micro">{group.name}</span>
          </button>
          <div className="bf-scene__pips">
            {group.steps.map((step) => {
              const state = step.n === demo.step ? 'current' : step.done ? 'done' : 'todo';
              return (
                <button
                  key={step.n}
                  type="button"
                  tabIndex={-1}
                  className="bf-pip"
                  data-state={state}
                  disabled={demo.busy}
                  title={`${step.n}. ${step.title}${step.done ? ' (done)' : ''}`}
                  aria-label={`Step ${step.n}: ${step.title}${step.done ? ', done' : ''}`}
                  {...(state === 'current' ? { 'aria-current': 'step' as const } : {})}
                  onClick={() => {
                    void demo.goto(step.n);
                  }}
                />
              );
            })}
          </div>
        </li>
      ))}
    </ol>
  );
}

/** The running step's progress (`activeJob`) or an indeterminate "working" line. Renders nothing when idle. */
export function JobProgress() {
  const { activeJob, busy } = useDemo();
  if (!busy) return null;
  const progress = activeJob?.progress;
  const known = progress && progress.total > 0;
  return (
    <div
      className="bf-presenter__progress"
      role="status"
      aria-live="polite"
      data-testid="demo-progress"
    >
      {known ? (
        <Meter
          value={progress.done}
          min={0}
          max={progress.total}
          tone="ember"
          size="sm"
          label="Progress of the running step"
          valueText={`${progress.done} of ${progress.total}`}
          showValue
        />
      ) : (
        <span className="bf-presenter__working">
          <Spinner size={14} />
          Working…
        </span>
      )}
      <span className="bf-presenter__job-label">
        {progress?.label ?? 'Running the real services behind this step'}
      </span>
    </div>
  );
}

function HumanStepNotice() {
  const demo = useDemo();
  const { current } = demo;
  if (!current || current.kind !== 'human' || current.done || demo.canPromote) return null;
  return (
    <div className="bf-presenter__rbac" role="note" data-testid="demo-rbac">
      <ShieldAlert size={16} aria-hidden="true" />
      <p>
        <strong>Promotion is a human decision.</strong> Only a reviewer or admin can approve it; the
        server enforces this. Operators prepare the evidence but cannot promote.
      </p>
      {demo.reviewerPersona ? (
        <Button
          size="sm"
          variant="ghost"
          icon={<UserRoundCheck size={14} />}
          data-testid="demo-switch-reviewer"
          onClick={() => {
            void demo.switchToReviewer();
          }}
        >
          Switch to {firstName(demo.reviewerPersona.displayName)} (
          {ROLE_META.reviewer.label.toLowerCase()})
        </Button>
      ) : null}
    </div>
  );
}

function ErrorLine() {
  const { error, clearError } = useDemo();
  if (!error) return null;
  return (
    <div className="bf-presenter__error" role="alert" data-testid="demo-error">
      <p>
        <strong>
          {error instanceof ApiError ? `${error.status || 'Offline'} ${error.code}` : 'Error'}:
        </strong>{' '}
        {errorMessage(error)}
      </p>
      <Button size="sm" aria-label="Dismiss error" icon={<X size={14} />} onClick={clearError} />
    </div>
  );
}

/** Back / action / Next, then the secondary controls. Icon-only below 1700px so the narration keeps its width. */
function PresenterControls() {
  const demo = useDemo();
  const wide = useMediaQuery('(min-width: 1700px)');
  const { current } = demo;
  const last = demo.step >= demo.total;
  const needsAction = current !== undefined && current.kind !== 'view' && !current.done;
  const roleBlock =
    needsAction && !demo.canRun
      ? 'Your role cannot run actions. Switch to an operator or reviewer.'
      : undefined;
  const humanBlock =
    current?.kind === 'human' && !demo.canPromote
      ? 'Only a reviewer or admin can promote a Reflex.'
      : undefined;
  const actionBlock = humanBlock ?? roleBlock;

  return (
    <div className="bf-presenter__controls">
      <Button
        size="md"
        icon={<ChevronLeft size={16} />}
        disabled={demo.busy || demo.step <= 1}
        data-testid="demo-back"
        onClick={() => {
          void demo.back();
        }}
      >
        Back {wide ? <Kbd aria-hidden="true">←</Kbd> : null}
      </Button>

      {needsAction && current ? (
        <Button
          size="md"
          variant="forge"
          loading={demo.busy}
          disabled={Boolean(actionBlock)}
          {...(actionBlock ? { disabledReason: actionBlock } : {})}
          onClick={() => {
            void demo.performCurrent();
          }}
          data-testid="demo-action"
        >
          {current.actionLabel ?? 'Run this step'}
        </Button>
      ) : null}

      <Button
        size="md"
        variant="primary"
        iconRight={<ChevronRight size={16} />}
        disabled={demo.busy || Boolean(demo.nextBlocked) || !current}
        {...(demo.nextBlocked ? { disabledReason: demo.nextBlocked } : {})}
        onClick={() => {
          void demo.next();
        }}
        data-testid="demo-next"
      >
        {last ? 'Finish' : 'Next'} {wide ? <Kbd aria-hidden="true">→</Kbd> : null}
      </Button>

      <span className="bf-presenter__divider" aria-hidden="true" />

      <Tooltip content="Restart from step 1 (R)" side="top">
        <Button
          size="md"
          aria-label="Restart from step 1"
          icon={<RotateCcw size={15} />}
          disabled={demo.busy}
          data-testid="demo-restart"
          onClick={() => {
            void demo.restart();
          }}
        >
          {wide ? (
            <>
              Restart <Kbd aria-hidden="true">R</Kbd>
            </>
          ) : null}
        </Button>
      </Tooltip>
      <Tooltip
        content={
          demo.presentation
            ? 'Show the navigation again'
            : 'Presentation layout: hide the chrome, larger type'
        }
        side="top"
      >
        <Button
          size="md"
          aria-label="Presentation layout"
          aria-pressed={demo.presentation}
          icon={demo.presentation ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          data-testid="demo-presentation"
          onClick={demo.togglePresentation}
        >
          {wide ? 'Presentation' : null}
        </Button>
      </Tooltip>
      <Tooltip
        content={demo.collapsed ? 'Expand the presenter' : 'Collapse the presenter'}
        side="top"
      >
        <Button
          size="md"
          aria-label={demo.collapsed ? 'Expand the presenter' : 'Collapse the presenter'}
          aria-expanded={!demo.collapsed}
          icon={demo.collapsed ? <ChevronsUpDown size={15} /> : <ChevronsDownUp size={15} />}
          data-testid="demo-collapse"
          onClick={demo.toggleCollapsed}
        />
      </Tooltip>
      <Tooltip content="Exit the guided demo (Esc)" side="top" align="end">
        <Button
          size="md"
          aria-label="Exit the guided demo"
          icon={<X size={15} />}
          data-testid="demo-exit"
          onClick={demo.exit}
        >
          {wide ? (
            <>
              Exit <Kbd aria-hidden="true">Esc</Kbd>
            </>
          ) : null}
        </Button>
      </Tooltip>
    </div>
  );
}

/**
 * The guided demo's bottom bar: step N/25, the scene progress rail, title and narration, Back / Next /
 * Restart / Exit, the step's action button and a distinct control for the human "Promote Reflex" step.
 * Keyboard: ArrowRight, ArrowLeft, Esc, R (handled in useDemo).
 */
export function PresenterBar() {
  const demo = useDemo();
  const { current } = demo;
  if (!demo.open) return null;

  const kind = current ? KIND_CHIP[current.kind] : null;
  const pending = current ? pendingBefore(demo.steps, current.n) : [];

  return (
    <section
      className={cx('bf-presenter', demo.collapsed && 'bf-presenter--collapsed')}
      aria-label="Guided demo"
      data-testid="demo-presenter"
      data-step={current?.n}
      data-step-id={current?.id}
    >
      {demo.collapsed ? null : <ScenePips />}
      <div className="bf-presenter__main">
        <div className="bf-presenter__copy" aria-live="polite" aria-atomic="true">
          {current ? (
            <>
              <p className="bf-presenter__eyebrow">
                <span className="micro">
                  Step {current.n} / {demo.total} · {current.scene}
                </span>
                {kind ? (
                  <Chip size="sm" tone={kind.tone} variant="outline">
                    {kind.label}
                  </Chip>
                ) : null}
                {current.done ? (
                  <Chip size="sm" tone="jade" variant="soft" icon={<CircleCheck size={11} />}>
                    Done
                  </Chip>
                ) : null}
              </p>
              <h2 className="bf-presenter__title" data-testid="demo-title">
                {current.title}
              </h2>
              {demo.collapsed ? null : (
                <p className="bf-presenter__narration">{current.narration}</p>
              )}
            </>
          ) : (
            <p className="bf-presenter__narration">
              {demo.isLoading ? 'Loading the guided demo…' : 'The guided demo is not available.'}
            </p>
          )}
        </div>

        <PresenterControls />
      </div>

      {demo.collapsed ? null : (
        <>
          {pending.length > 0 && current && current.kind !== 'view' && !current.done ? (
            <p className="bf-presenter__note">
              {pending.length === 1 ? 'Step ' : 'Steps '}
              {pending.map((step) => step.n).join(', ')} {pending.length === 1 ? 'has' : 'have'} not
              run yet and will run first.
            </p>
          ) : null}
          <HumanStepNotice />
        </>
      )}
      <JobProgress />
      <ErrorLine />
    </section>
  );
}
