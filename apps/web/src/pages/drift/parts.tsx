import { ArrowRight, Check } from 'lucide-react';
import type { ReactNode } from 'react';
import type { JobDto } from '@bigforge/schemas';
import { Chip, Meter, Spinner } from '../../ui';

/** Numbered stage heading: the page reads as the five steps of the drift story. */
export function StageHead({
  n,
  id,
  title,
  lede,
  actions,
  state,
}: {
  n?: number;
  id: string;
  title: string;
  lede: ReactNode;
  actions?: ReactNode;
  state?: { label: string; tone: 'jade' | 'crimson' | 'ember' | 'ash' | 'amber' };
}) {
  return (
    <header className="drift-stage__head">
      <span
        className="drift-stage__n"
        aria-hidden="true"
        data-empty={n === undefined ? 'true' : undefined}
      >
        {n}
      </span>
      <div className="drift-stage__titles">
        <h2 id={id} className="drift-stage__title">
          {title}
          {state ? (
            <Chip tone={state.tone} size="sm" variant="outline" className="drift-stage__state">
              {state.label}
            </Chip>
          ) : null}
        </h2>
        <p className="drift-stage__lede">{lede}</p>
      </div>
      {actions ? <div className="drift-stage__actions">{actions}</div> : null}
    </header>
  );
}

/** `forge-ci 1.4.2 -> 1.5.0` as a chip: the world changed. */
export function DiffChip({ from, to }: { from: string; to: string }) {
  return (
    <Chip tone="crimson" variant="outline" mono className="drift-diff" data-testid="drift-diff">
      forge-ci {from}
      <ArrowRight size={12} aria-hidden="true" />
      {to}
      <span className="sr-only"> (changed)</span>
    </Chip>
  );
}

/** Progress of a running job: a meter when the total is known, otherwise a working line. Polite live region. */
export function JobLine({
  job,
  idle,
}: {
  job: Pick<JobDto, 'progress' | 'status'> | null;
  idle?: ReactNode;
}) {
  if (!job) return idle ? <p className="drift-job drift-job--idle">{idle}</p> : null;
  const { progress } = job;
  const known = progress.total > 0;
  return (
    <div className="drift-job" role="status" aria-live="polite">
      {known ? (
        <Meter
          value={progress.done}
          min={0}
          max={progress.total}
          tone="ember"
          size="sm"
          label="Job progress"
          valueText={`${progress.done} of ${progress.total}`}
          showValue
        />
      ) : (
        <span className="drift-job__working">
          <Spinner size={14} /> Working
        </span>
      )}
      <span className="drift-job__label">
        {progress.label || 'Running the real services behind this step'}
      </span>
    </div>
  );
}

export function DoneTick({ children }: { children: ReactNode }) {
  return (
    <span className="drift-done">
      <Check size={14} aria-hidden="true" />
      {children}
    </span>
  );
}
