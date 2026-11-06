import { FORGE_STAGES, type ForgeStageId } from '../stages';
import { cx } from '../ui/cx';

interface PipelineStripProps {
  /** Stages that glow. Ember = heat; the Escalate stage glows molten (the uncertainty boundary). */
  active: readonly ForgeStageId[];
  className?: string;
}

/**
 * The Forge loop as a thin segmented pipeline: Observe, Fingerprint, Compile, Validate, Execute,
 * Escalate, Evolve. The stage relevant to the current page glows.
 */
export function PipelineStrip({ active, className }: PipelineStripProps) {
  const activeStages = FORGE_STAGES.filter((stage) => active.includes(stage.id));
  const names = activeStages.map((stage) => stage.label);
  const firstIndex = activeStages[0] ? FORGE_STAGES.indexOf(activeStages[0]) : -1;
  // Narrow widths draw one joined label for all active stages, from the segment it can grow away from.
  const anchorEnd = firstIndex >= 4;
  const anchor = anchorEnd ? activeStages[activeStages.length - 1] : activeStages[0];
  return (
    <ol
      className={cx('bf-pipe', className)}
      aria-label={names.length ? `Forge pipeline. Active: ${names.join(', ')}` : 'Forge pipeline'}
    >
      {FORGE_STAGES.map((stage, index) => {
        const isActive = active.includes(stage.id);
        return (
          <li
            key={stage.id}
            className="bf-pipe__stage"
            data-stage={stage.id}
            data-active={isActive ? 'true' : undefined}
            data-anchor={anchor?.id === stage.id ? (anchorEnd ? 'end' : 'start') : undefined}
            {...(isActive ? { 'aria-current': 'step' as const } : {})}
          >
            <span className="bf-pipe__label">
              <span className="bf-pipe__index num" aria-hidden="true">
                {index + 1}
              </span>
              <span className="bf-pipe__name">{stage.label}</span>
              {anchor?.id === stage.id ? (
                <span className="bf-pipe__joined" aria-hidden="true">
                  {names.join(' \u00b7 ')}
                </span>
              ) : null}
            </span>
            <span className="bf-pipe__bar" aria-hidden="true" />
          </li>
        );
      })}
    </ol>
  );
}
