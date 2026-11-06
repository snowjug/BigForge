import { ArrowDownRight, ArrowUpRight, Info, Minus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useMetricDefinitions } from '../api/hooks';
import { cx } from './cx';
import { Popover } from './Popover';
import { Provenance } from './Provenance';
import type { ProvenanceKind } from './provenance';
import { Skeleton } from './Skeleton';
import type { Tone } from './tone';

export interface MetricDelta {
  text: string;
  direction?: 'up' | 'down' | 'flat';
  /** Colour follows meaning, not direction: a falling cost is "good". The arrow shape carries direction. */
  sentiment?: 'good' | 'bad' | 'neutral';
}

export interface MetricProps {
  label: string;
  /** Pre-formatted value (see formatters.ts). Pass `null`/`undefined` when there is no data yet. */
  value: ReactNode;
  unit?: string;
  /**
   * Required on purpose: every figure is `measured`, `synthetic`, `simulated`, `estimated` or
   * `replay-measured` (several for composites). Use 'none' only for plain configuration values.
   */
  provenance: ProvenanceKind | readonly ProvenanceKind[] | 'none';
  /** Metric id in `GET /api/metrics/definitions`; adds the definition popover and enriches the provenance tooltip. */
  definition?: string;
  delta?: MetricDelta;
  hint?: ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'hero';
  loading?: boolean;
  /** Tints the value: ember = tokens spent, steel = local work, jade = verified, crimson = failing. */
  tone?: Tone;
  className?: string;
}

function DefinitionButton({ id, label }: { id: string; label: string }) {
  const { data } = useMetricDefinitions();
  const definition = data?.[id];
  if (!definition) return null;
  return (
    <Popover
      interactive={false}
      label={`Definition of ${label}`}
      side="bottom"
      align="start"
      content={
        <div className="bf-def">
          <p className="bf-def__title">{definition.label}</p>
          <p>{definition.definition}</p>
          <p className="faint">Source: {definition.source}</p>
          {definition.formula ? <p className="mono bf-def__formula">{definition.formula}</p> : null}
          {definition.limitations ? (
            <p className="bf-def__limit">Limitation: {definition.limitations}</p>
          ) : null}
        </div>
      }
    >
      <button type="button" className="bf-metric__info" aria-label={`Definition of ${label}`}>
        <Info size={13} strokeWidth={2} aria-hidden="true" />
      </button>
    </Popover>
  );
}

const DELTA_ICON = {
  up: <ArrowUpRight size={12} strokeWidth={2.25} aria-hidden="true" />,
  down: <ArrowDownRight size={12} strokeWidth={2.25} aria-hidden="true" />,
  flat: <Minus size={12} strokeWidth={2.25} aria-hidden="true" />,
} as const;

/**
 * A single figure: label, value, unit, provenance, optional delta and definition popover.
 * Numbers use tabular figures; hero values use the display face.
 */
export function Metric({
  label,
  value,
  unit,
  provenance,
  definition,
  delta,
  hint,
  size = 'md',
  loading = false,
  tone,
  className,
}: MetricProps) {
  const empty = value === null || value === undefined || value === '';
  return (
    <div
      className={cx('bf-metric', `bf-metric--${size}`, className)}
      {...(tone ? { 'data-tone': tone } : {})}
    >
      <div className="bf-metric__label">
        <span className="micro">{label}</span>
        {definition ? <DefinitionButton id={definition} label={label} /> : null}
      </div>
      <div className="bf-metric__value">
        {loading ? (
          <Skeleton width="5ch" height={size === 'hero' ? 40 : 22} />
        ) : (
          <>
            <span className={cx('bf-metric__number num', empty && 'bf-metric__number--empty')}>
              {empty ? '\u2014' : value}
            </span>
            {unit && !empty ? <span className="bf-metric__unit">{unit}</span> : null}
          </>
        )}
      </div>
      {provenance !== 'none' || delta ? (
        <div className="bf-metric__meta">
          {provenance !== 'none' ? (
            <Provenance kind={provenance} {...(definition ? { metric: definition } : {})} />
          ) : null}
          {delta ? (
            <span className="bf-metric__delta" data-sentiment={delta.sentiment ?? 'neutral'}>
              {DELTA_ICON[delta.direction ?? 'flat']}
              {delta.text}
            </span>
          ) : null}
        </div>
      ) : null}
      {hint ? <p className="bf-metric__hint">{hint}</p> : null}
    </div>
  );
}
