import type { EnvironmentDto, ScenarioDto } from '@bigforge/schemas';
import { Send } from 'lucide-react';
import { type KeyboardEvent, useRef, useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { Button, Chip, ErrorState, Skeleton, SkeletonGroup, Tooltip, cx, plural } from '../../ui';
import { FAULT_LABEL, SCENARIO_STATE, groupScenarios, scenarioState } from './selectors';

export interface TaskRailProps {
  scenarios: readonly ScenarioDto[] | undefined;
  loading: boolean;
  error: unknown;
  onRetry: () => void;
  environment: EnvironmentDto | undefined;
  /** The scenario whose task is open on the canvas. */
  openScenarioId: string | null;
  /** The scenario the next "Send failure" would send. */
  armed: ScenarioDto | null;
  onArm: (scenarioId: string) => void;
  onOpenTask: (taskId: string) => void;
  onSend: () => void;
  sending: boolean;
  /** Why sending is unavailable, or null. */
  sendDisabledReason: string | null;
}

export function TaskRail({
  scenarios,
  loading,
  error,
  onRetry,
  environment,
  openScenarioId,
  armed,
  onArm,
  onOpenTask,
  onSend,
  sending,
  sendDisabledReason,
}: TaskRailProps) {
  const compact = useMediaQuery('(max-width: 1099px)');
  const groups = scenarios ? groupScenarios(scenarios) : [];
  const flat = groups.flatMap((group) => group.items);
  const sent = flat.filter((scenario) => scenario.taskId !== null).length;
  const allSent = flat.length > 0 && sent === flat.length;
  const refs = useRef(new Map<string, HTMLButtonElement>());
  const [focusId, setFocusId] = useState<string | null>(null);
  const tabbable =
    focusId && flat.some((s) => s.id === focusId)
      ? focusId
      : (openScenarioId ?? armed?.id ?? flat[0]?.id ?? null);

  const move = (current: string, delta: number | 'first' | 'last') => {
    const index = flat.findIndex((scenario) => scenario.id === current);
    const next =
      delta === 'first'
        ? 0
        : delta === 'last'
          ? flat.length - 1
          : Math.max(0, Math.min(flat.length - 1, index + delta));
    const target = flat[next];
    if (target) {
      setFocusId(target.id);
      refs.current.get(target.id)?.focus();
    }
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>, id: string) => {
    switch (event.key) {
      case 'ArrowDown':
        move(id, 1);
        break;
      case 'ArrowUp':
        move(id, -1);
        break;
      case 'Home':
        move(id, 'first');
        break;
      case 'End':
        move(id, 'last');
        break;
      default:
        return;
    }
    event.preventDefault();
  };

  const activate = (scenario: ScenarioDto) => {
    if (scenario.taskId) onOpenTask(scenario.taskId);
    else onArm(scenario.id);
  };

  const list = (
    <div
      className="run-scenarios"
      data-testid="scenario-list"
      role="group"
      aria-label="Failure scenarios"
    >
      {groups.map((group) => (
        <section
          key={group.role}
          className="run-scenarios__group"
          aria-label={`${group.label} failures`}
        >
          <h3 className="run-scenarios__heading">
            <span className="micro">{group.label}</span>
            <span className="micro num">
              {group.items.filter((item) => item.taskId).length}/{group.items.length}
            </span>
          </h3>
          <ul>
            {group.items.map((scenario) => {
              const state = scenarioState(scenario);
              const meta = SCENARIO_STATE[state];
              const isOpen = openScenarioId === scenario.id;
              const isArmed = armed?.id === scenario.id && scenario.taskId === null;
              return (
                <li key={scenario.id}>
                  <button
                    ref={(element) => {
                      if (element) refs.current.set(scenario.id, element);
                      else refs.current.delete(scenario.id);
                    }}
                    type="button"
                    className={cx('run-scenario', isOpen && 'is-open', isArmed && 'is-armed')}
                    tabIndex={tabbable === scenario.id ? 0 : -1}
                    {...(scenario.taskId
                      ? { 'aria-current': isOpen ? ('true' as const) : undefined }
                      : { 'aria-pressed': isArmed })}
                    onClick={() => {
                      activate(scenario);
                    }}
                    onFocus={() => {
                      setFocusId(scenario.id);
                    }}
                    onKeyDown={(event) => {
                      onKeyDown(event, scenario.id);
                    }}
                    data-state={state}
                    data-scenario={scenario.id}
                  >
                    <span className="run-scenario__id mono">{scenario.id}</span>
                    <span className="run-scenario__body">
                      <span className="run-scenario__title">{scenario.title}</span>
                      <span className="run-scenario__meta">
                        {FAULT_LABEL[scenario.fault]} &middot;{' '}
                        {scenario.workspace.replace('packages/', '')}
                        {scenario.ambiguous ? ' \u00b7 ambiguous' : ''}
                      </span>
                    </span>
                    <Chip
                      tone={meta.tone}
                      size="sm"
                      variant={state === 'not_sent' ? 'outline' : 'soft'}
                      dashed={state === 'not_sent'}
                    >
                      {isArmed ? 'Next' : meta.label}
                    </Chip>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );

  return (
    <aside className="run-rail" aria-label="Task rail">
      <div className="run-rail__head">
        <div className="run-rail__env">
          <span className="micro">Toolchain</span>
          {environment ? (
            <Tooltip
              content={
                environment.available.find(
                  (entry) => entry.version === environment.toolchainVersion,
                )?.description ?? 'The synthetic build tool the lab runs.'
              }
            >
              <button
                type="button"
                className="run-env mono"
                aria-label={`Toolchain forge-ci ${environment.toolchainVersion}`}
              >
                forge-ci {environment.toolchainVersion}
              </button>
            </Tooltip>
          ) : (
            <Skeleton width={96} height={22} />
          )}
        </div>

        <div className="run-rail__send">
          <p className="micro">{allSent ? 'Failures' : 'Next failure to send'}</p>
          {allSent ? (
            <p className="dim run-rail__armed">
              All {plural(flat.length, 'failure')} have been sent. Open one below to see what
              happened to it.
            </p>
          ) : armed ? (
            <p className="run-rail__armed">
              <span className="mono run-rail__armed-id">{armed.id}</span>
              <span>{armed.title}</span>
            </p>
          ) : (
            <p className="dim">Loading the scenario catalogue</p>
          )}
          <Button
            variant="forge"
            block
            icon={<Send size={15} />}
            loading={sending}
            disabled={sendDisabledReason !== null || !armed}
            {...(sendDisabledReason ? { disabledReason: sendDisabledReason } : {})}
            onClick={onSend}
            data-testid="send-failure"
          >
            Send failure to BigForge
          </Button>
          {sendDisabledReason ? (
            <p className="run-rail__reason faint">{sendDisabledReason}</p>
          ) : null}
        </div>
      </div>

      <div className="run-rail__list">
        <div className="run-rail__count">
          <span className="micro">Failure scenarios</span>
          <span className="micro num">{scenarios ? `${sent} of ${flat.length} sent` : ''}</span>
        </div>
        {error ? (
          <ErrorState
            compact
            title="Could not load the scenarios"
            error={error}
            onRetry={onRetry}
          />
        ) : loading || !scenarios ? (
          <SkeletonGroup label="Loading scenarios" className="run-scenarios__skeleton">
            {Array.from({ length: 6 }, (_, index) => (
              <Skeleton key={index} height={44} radius={6} />
            ))}
          </SkeletonGroup>
        ) : compact ? (
          <details className="run-rail__more">
            <summary>Choose a failure ({flat.length})</summary>
            {list}
          </details>
        ) : (
          list
        )}
      </div>
    </aside>
  );
}
