import { Bot, Eye, Lock, ScanEye } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import type { DriftCheckDto, ReflexStatus, TransitionDto } from '@bigforge/schemas';
import { Chip, StatusChip, formatTimestamp } from '../../ui';
import { useDemoTarget } from '../../demo/useDemo';
import { lifecycleRibbon } from './model';
import { StageHead } from './parts';

const STAGE_ICON: Partial<Record<ReflexStatus, ReactNode>> = {
  active: <Lock size={14} />,
  watch: <ScanEye size={14} />,
  shadow: <Eye size={14} />,
};

/** Active, Watch, Shadow: the real transitions of the latest canary, with the reasons the system recorded. */
export function LifecyclePanel({
  check,
  transitions,
  status,
}: {
  check: DriftCheckDto | null;
  transitions: readonly TransitionDto[];
  status: ReflexStatus | null;
}) {
  const target = useDemoTarget('back_to_shadow');
  const ribbon = status ? lifecycleRibbon(check, transitions, status) : null;
  const demoted = Boolean(ribbon && ribbon.links.length > 0);
  const columns = ribbon
    ? ribbon.stages
        .map((_, index) => (index < ribbon.stages.length - 1 ? 'auto minmax(0, 1fr)' : 'auto'))
        .join(' ')
    : 'auto';

  return (
    <section
      className="drift-stage"
      id="drift-lifecycle"
      aria-labelledby="drift-lifecycle-title"
      {...target}
    >
      <StageHead
        n={4}
        id="drift-lifecycle-title"
        title="Back to Shadow, automatically"
        lede="No human is needed to stop it. Moving to a safer state is always allowed; moving back up never is."
        state={
          status
            ? demoted
              ? { label: 'demoted by the canary', tone: 'crimson' }
              : { label: 'no demotion', tone: 'ash' }
            : { label: 'no Reflex', tone: 'ash' }
        }
      />
      {ribbon && status ? (
        <div className="drift-lifecycle" data-testid="lifecycle-ribbon">
          <ol
            className="drift-ribbon"
            style={{ '--cols': columns } as CSSProperties}
            aria-label="Lifecycle path of the Reflex after the canary"
          >
            {ribbon.stages.flatMap((stage, index) => {
              const link = ribbon.links[index];
              const items: ReactNode[] = [
                <li
                  key={`stage-${index}`}
                  className="drift-ribbon__stage"
                  data-position={stage.position}
                  data-status={stage.status}
                >
                  <span className="drift-ribbon__icon" aria-hidden="true">
                    {STAGE_ICON[stage.status]}
                  </span>
                  <span className="drift-ribbon__label">{stage.label}</span>
                  <span className="micro">{stage.position === 'current' ? 'now' : 'was'}</span>
                </li>,
              ];
              if (link) {
                items.push(
                  <li key={`link-${index}`} className="drift-ribbon__link">
                    <span className="mono drift-ribbon__event">{link.event}</span>
                    <span className="drift-ribbon__line" aria-hidden="true" />
                    <span className="drift-ribbon__reason">{link.reason}</span>
                    <span className="faint drift-ribbon__actor">
                      {link.automatic ? <Bot size={12} aria-hidden="true" /> : null}
                      {link.actor ?? 'BigForge'}
                      {link.at ? ` · ${formatTimestamp(link.at)}` : ''}
                      {link.automatic ? ' · automatic' : ''}
                    </span>
                  </li>,
                );
              }
              return items;
            })}
          </ol>
          <div className="drift-lifecycle__why">
            <p>
              <strong>Why this needs no human.</strong> A Reflex that may be wrong should stop
              running live at once, so the canary demotes it on its own. Trust is earned back the
              slow way: replay, Shadow Brain, and a reviewer&rsquo;s approval.
            </p>
            <p className="faint">
              Current status <StatusChip status={status} />
              {demoted ? (
                <>
                  {' '}
                  <Chip tone="ash" size="sm" dashed>
                    cannot execute live
                  </Chip>
                </>
              ) : null}
            </p>
          </div>
        </div>
      ) : (
        <p className="drift-empty-line">
          There is no Reflex yet, so there is no lifecycle to show.
        </p>
      )}
    </section>
  );
}
