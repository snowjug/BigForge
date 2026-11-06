import type { ReflexStatus, TransitionDto } from '@bigforge/schemas';
import {
  Archive,
  ArrowLeftRight,
  Ban,
  CircleDashed,
  Eye,
  Hammer,
  Hourglass,
  Lock,
  RotateCcw,
  ScanEye,
  Undo2,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { REFLEX_STATUS } from '../../ui';
import { type RibbonState, buildRibbon, eventLabel } from './lifecycle';

const ICON: Record<ReflexStatus, ReactNode> = {
  candidate: <CircleDashed size={13} />,
  replay: <RotateCcw size={13} />,
  shadow: <Eye size={13} />,
  approval: <Hourglass size={13} />,
  active: <Lock size={13} />,
  watch: <ScanEye size={13} />,
  recompile: <Hammer size={13} />,
  deprecated: <Ban size={13} />,
  retired: <Archive size={13} />,
};

const STATE_TEXT: Record<RibbonState, string> = {
  done: 'passed',
  current: 'current',
  upcoming: 'not reached',
  visited: 'was reached earlier and left',
};

interface StatusRibbonProps {
  status: ReflexStatus;
  /** With a history the ribbon can show earlier visits and return arcs; without it, it infers. */
  transitions?: readonly TransitionDto[];
  /** compact: dots with the current label only (registry rows). full: every stage named. */
  variant?: 'compact' | 'full';
  className?: string;
}

/**
 * The lifecycle ribbon: candidate, replay, shadow, approval, active, with Watch beside Active. The current
 * stage carries its status tone, icon and text; stages are never told apart by colour alone. A Reflex that
 * was demoted (drift, rejection) shows where it returned from.
 */
export function StatusRibbon({
  status,
  transitions,
  variant = 'full',
  className,
}: StatusRibbonProps) {
  const ribbon = buildRibbon(status, transitions);
  const meta = REFLEX_STATUS[status];
  return (
    <div
      className={className ? `rfx-ribbon-wrap ${className}` : 'rfx-ribbon-wrap'}
      data-testid="reflex-status"
      data-status={status}
    >
      <ol className="rfx-ribbon" data-variant={variant} aria-label={`Lifecycle: ${meta.label}`}>
        {ribbon.stages.map((stage) => {
          const stageMeta = REFLEX_STATUS[stage.status];
          const showLabel = variant === 'full' || stage.state === 'current';
          return (
            <li
              key={stage.status}
              className="rfx-ribbon__stage"
              data-state={stage.state}
              data-satellite={stage.satellite ? 'true' : undefined}
              data-status={stage.status}
              data-tone={stage.state === 'current' ? stageMeta.tone : undefined}
              aria-current={stage.state === 'current' ? 'step' : undefined}
              title={stageMeta.description}
            >
              {stage.satellite && stage.status === 'watch' ? (
                <span className="rfx-ribbon__link" aria-hidden="true">
                  <ArrowLeftRight size={12} />
                </span>
              ) : null}
              <span className="rfx-ribbon__pill">
                <span className="rfx-ribbon__icon" aria-hidden="true">
                  {ICON[stage.status]}
                </span>
                {showLabel ? <span className="rfx-ribbon__label">{stageMeta.label}</span> : null}
                <span className="sr-only">
                  {showLabel ? '' : stageMeta.label}: {STATE_TEXT[stage.state]}
                </span>
                {showLabel && stage.state !== 'current' ? (
                  <span className="sr-only">: {STATE_TEXT[stage.state]}</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
      {variant === 'full' && ribbon.returns.length > 0 ? (
        <ul className="rfx-ribbon__returns" aria-label="Returns to an earlier stage">
          {ribbon.returns.map((arc) => (
            <li key={`${arc.from}-${arc.to}-${arc.at}`}>
              <Undo2 size={13} aria-hidden="true" />
              <span>
                Returned to <strong>{REFLEX_STATUS[arc.to].label}</strong> from{' '}
                <strong>{REFLEX_STATUS[arc.from].label}</strong>:{' '}
                {eventLabel(arc.event).toLowerCase()}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
