import { cx } from './cx';
import { arcPoint, toRatio } from './gauge';
import type { Tone } from './tone';

interface MeterBase {
  /** Accessible name, for example "Shadow agreement". */
  label: string;
  /** The exact reading for assistive technology and the visible readout, for example "94.3%". */
  valueText: string;
  min?: number;
  max?: number;
  /** A reference mark (a gate or floor). */
  threshold?: number;
  thresholdLabel?: string;
  tone?: Tone;
  className?: string;
}

export interface MeterProps extends MeterBase {
  value: number;
  size?: 'sm' | 'md';
  /** Shows `valueText` beside the bar. */
  showValue?: boolean;
}

/** A horizontal meter with an optional threshold tick. Fill colour is the tone; the tick is a shape. */
export function Meter({
  value,
  label,
  valueText,
  min = 0,
  max = 1,
  threshold,
  thresholdLabel,
  tone = 'steel',
  size = 'md',
  showValue = false,
  className,
}: MeterProps) {
  const ratio = toRatio(value, min, max);
  const mark = threshold === undefined ? null : toRatio(threshold, min, max);
  return (
    <div className={cx('bf-meter', `bf-meter--${size}`, className)} data-tone={tone}>
      <div
        className="bf-meter__track"
        role="meter"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={thresholdLabel ? `${valueText}. ${thresholdLabel}` : valueText}
      >
        <div className="bf-meter__fill" style={{ width: `${ratio * 100}%` }} />
        {mark !== null ? (
          <span
            className="bf-meter__threshold"
            style={{ left: `${mark * 100}%` }}
            {...(thresholdLabel ? { title: thresholdLabel } : {})}
          />
        ) : null}
      </div>
      {showValue ? <span className="bf-meter__value num">{valueText}</span> : null}
    </div>
  );
}

export interface GaugeProps extends MeterBase {
  value: number;
  /** Small caption under the readout. Defaults to the label. */
  caption?: string;
  size?: number;
}

const ARC = { radius: 50, cx: 60, cy: 60 } as const;

/**
 * A semicircular gauge (confidence, CRR, verification pass rate). The exact value is always printed
 * in the centre; the threshold is a tick across the arc.
 */
export function Gauge({
  value,
  label,
  valueText,
  caption,
  min = 0,
  max = 1,
  threshold,
  thresholdLabel,
  tone = 'steel',
  size = 150,
  className,
}: GaugeProps) {
  const ratio = toRatio(value, min, max);
  const tick = threshold === undefined ? null : toRatio(threshold, min, max);
  const inner = tick === null ? null : arcPoint(tick, ARC.radius - 8, ARC.cx, ARC.cy);
  const outer = tick === null ? null : arcPoint(tick, ARC.radius + 8, ARC.cx, ARC.cy);
  return (
    <div
      className={cx('bf-gauge', className)}
      data-tone={tone}
      style={{ width: size }}
      role="meter"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={thresholdLabel ? `${valueText}. ${thresholdLabel}` : valueText}
    >
      <svg viewBox="0 0 120 72" aria-hidden="true" focusable="false">
        <path
          className="bf-gauge__track"
          d="M10 60 A50 50 0 0 1 110 60"
          pathLength={100}
          fill="none"
        />
        <path
          className="bf-gauge__fill"
          d="M10 60 A50 50 0 0 1 110 60"
          pathLength={100}
          fill="none"
          strokeDasharray={`${ratio * 100} 100`}
        />
        {inner && outer ? (
          <line className="bf-gauge__tick" x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} />
        ) : null}
      </svg>
      <div className="bf-gauge__readout">
        <span className="bf-gauge__value num">{valueText}</span>
        <span className="bf-gauge__caption micro">{caption ?? label}</span>
      </div>
    </div>
  );
}
