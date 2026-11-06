import type { RunMode } from '../../api/types';
import { GitCompareArrows, Lock, Play, Workflow } from 'lucide-react';
import { Button, Panel, Spinner } from '../../ui';
import { ApiError, errorMessage } from '../../api/client';
import type { Availability, ModeAvailability } from './selectors';

export interface RunActionsProps {
  availability: Availability;
  /** The mode that is running now, or null. */
  running: RunMode | null;
  error: unknown;
  /** One sentence on which path "auto" would take. */
  pathSummary: string;
  onRun: (mode: RunMode) => void;
}

interface ModeSpec {
  mode: RunMode;
  label: string;
  testId: string;
  blurb: string;
  variant: 'ghost' | 'forge' | 'primary';
  icon: React.ReactNode;
}

const MODES: readonly ModeSpec[] = [
  {
    mode: 'baseline',
    label: 'Run baseline',
    testId: 'run-baseline',
    blurb:
      'The AI agent does everything and calls the model on every turn. This is also the measured reference.',
    variant: 'ghost',
    icon: <Play size={15} />,
  },
  {
    mode: 'auto',
    label: 'Run auto',
    testId: 'run-auto',
    blurb:
      'Use the matched Reflex: known steps run locally and only the unknown crosses the Token Firewall.',
    variant: 'forge',
    icon: <Workflow size={15} />,
  },
  {
    mode: 'compare',
    label: 'Run compare',
    testId: 'run-compare',
    blurb:
      'Run the Reflex and a baseline reference on the same task, then compare them side by side.',
    variant: 'primary',
    icon: <GitCompareArrows size={15} />,
  },
];

export function RunActions({ availability, running, error, pathSummary, onRun }: RunActionsProps) {
  const busy = running !== null;
  // When every path is blocked for the same reason, say it once instead of three times.
  const reasons = MODES.map((spec) => availability[spec.mode].reason);
  const commonReason = reasons.every((reason) => reason !== null && reason === reasons[0])
    ? reasons[0]
    : null;
  return (
    <section className="run-region" aria-labelledby="run-actions-title">
      <Panel title={<span id="run-actions-title">Choose a path</span>} subtitle={pathSummary}>
        {commonReason ? (
          <p className="run-actions__lock" role="note">
            <Lock size={14} aria-hidden="true" /> {commonReason}
          </p>
        ) : null}
        <ul className="run-modes">
          {MODES.map((spec) => {
            const state: ModeAvailability = availability[spec.mode];
            const unavailable = !state.enabled || (busy && running !== spec.mode);
            return (
              <li key={spec.mode} className="run-mode">
                <Button
                  variant={spec.variant}
                  icon={spec.icon}
                  loading={running === spec.mode}
                  disabled={unavailable}
                  {...(!state.enabled && state.reason ? { disabledReason: state.reason } : {})}
                  onClick={() => {
                    onRun(spec.mode);
                  }}
                  data-testid={spec.testId}
                  block
                >
                  {spec.label}
                </Button>
                <p className="run-mode__blurb dim">{spec.blurb}</p>
                {!state.enabled && state.reason ? (
                  <p className="run-mode__reason faint">{state.reason}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
        <div className="run-actions__status" role="status" aria-live="polite">
          {busy ? (
            <p className="run-actions__busy">
              <Spinner size={14} />
              <span>
                {running === 'baseline'
                  ? 'The baseline agent is working in the sandbox: a model call, then a command, again and again.'
                  : running === 'auto'
                    ? 'Running through the Reflex in the sandbox: known steps first.'
                    : 'Running the Reflex and the baseline reference in separate sandboxes.'}
              </span>
            </p>
          ) : null}
        </div>
        {error ? (
          <p className="run-actions__error" role="alert">
            {error instanceof ApiError && error.isForbidden ? 'Your role may not run tasks. ' : ''}
            {errorMessage(error)}
          </p>
        ) : null}
      </Panel>
    </section>
  );
}
