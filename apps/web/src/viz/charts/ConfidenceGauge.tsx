import { arcPath, polar, tickLine } from './arc';
import './charts.css';

export interface ConfidenceGaugeProps {
  /** Confidence before the canary (0..1), or null when there is no earlier reading. */
  before: number | null;
  after: number;
  /** Below this confidence an active Reflex goes on watch. */
  watchBelow: number;
  /** 90% interval around the current reading. */
  interval?: { low: number; high: number } | null;
  ariaLabel: string;
}

const CX = 160;
const CY = 124;
const R = 88;
const STROKE = 14;

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * A semicircular confidence gauge that shows the fall: the arc is filled up to the current confidence,
 * the lost span back to the earlier reading is hatched, and the watch threshold is a dashed tick.
 */
export function ConfidenceGauge({
  before,
  after,
  watchBelow,
  interval,
  ariaLabel,
}: ConfidenceGaugeProps) {
  const fell = before !== null && after < before;
  const belowWatch = after < watchBelow;
  const delta = before === null ? null : Math.round((after - before) * 100);
  const beforeTick =
    before === null ? null : tickLine(before, R - STROKE / 2 - 3, R + STROKE / 2 + 5, CX, CY);
  const watchTick = tickLine(watchBelow, R - STROKE / 2 - 3, R + STROKE / 2 + 3, CX, CY);
  const beforeLabel = before === null ? null : polar(before, R + 24, CX, CY);

  return (
    <figure className="bf-cg" data-tone={belowWatch ? 'crimson' : 'steel'}>
      <svg
        className="bf-cg__svg"
        width="320"
        height="150"
        viewBox="0 0 320 150"
        role="img"
        aria-label={ariaLabel}
      >
        <path className="bf-cg__track" d={arcPath(0, 1, R, CX, CY)} strokeWidth={STROKE} />
        {fell && before !== null ? (
          <path
            className="bf-cg__lost"
            d={arcPath(after, before, R, CX, CY)}
            strokeWidth={STROKE}
          />
        ) : null}
        <path className="bf-cg__fill" d={arcPath(0, after, R, CX, CY)} strokeWidth={STROKE} />
        {interval ? (
          <path
            className="bf-cg__interval"
            d={arcPath(interval.low, interval.high, R + STROKE / 2 + 9, CX, CY)}
          />
        ) : null}
        <line
          className="bf-cg__watch"
          x1={watchTick.from.x}
          y1={watchTick.from.y}
          x2={watchTick.to.x}
          y2={watchTick.to.y}
        />
        {beforeTick ? (
          <line
            className="bf-cg__before"
            x1={beforeTick.from.x}
            y1={beforeTick.from.y}
            x2={beforeTick.to.x}
            y2={beforeTick.to.y}
          />
        ) : null}
        {beforeLabel && before !== null ? (
          <text
            className="bf-cg__was"
            x={beforeLabel.x}
            y={beforeLabel.y}
            textAnchor={before > 0.6 ? 'start' : before < 0.4 ? 'end' : 'middle'}
            dominantBaseline="central"
          >
            {`was ${pct(before)}`}
          </text>
        ) : null}
        <text className="bf-cg__value" x={CX} y={CY - 8} textAnchor="middle">
          {pct(after)}
        </text>
        <text className="bf-cg__caption" x={CX} y={CY + 12} textAnchor="middle">
          CONFIDENCE
        </text>
        {delta !== null && delta !== 0 ? (
          <text className="bf-cg__delta" x={CX} y={CY + 30} textAnchor="middle">
            {`${delta < 0 ? '\u25bc' : '\u25b2'} ${delta < 0 ? '\u2212' : '+'}${Math.abs(delta)} points`}
          </text>
        ) : null}
      </svg>
      <figcaption className="bf-cg__legend" aria-hidden="true">
        <span className="bf-cg__key">
          <svg width="16" height="12" viewBox="0 0 16 12" focusable="false">
            <line className="bf-cg__before" x1="8" y1="1" x2="8" y2="11" />
          </svg>
          earlier reading
        </span>
        <span className="bf-cg__key">
          <svg width="16" height="12" viewBox="0 0 16 12" focusable="false">
            <line className="bf-cg__watch" x1="8" y1="1" x2="8" y2="11" />
          </svg>
          watch below {pct(watchBelow)}
        </span>
        {interval ? (
          <span className="bf-cg__key">
            <svg width="16" height="12" viewBox="0 0 16 12" focusable="false">
              <line className="bf-cg__interval-key" x1="1" y1="6" x2="15" y2="6" />
            </svg>
            90% interval
          </span>
        ) : null}
      </figcaption>
    </figure>
  );
}
