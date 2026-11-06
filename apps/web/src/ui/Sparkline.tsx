import { useId } from 'react';
import { cx } from './cx';
import { sparklineGeometry } from './sparkline';
import type { Tone } from './tone';

export interface SparklineProps {
  data: readonly number[];
  /** Accessible description, for example "Agreement over the last 12 comparisons". */
  label: string;
  width?: number;
  height?: number;
  tone?: Tone;
  min?: number;
  max?: number;
  /** Draws a dashed reference line (for example a drift floor). */
  threshold?: number;
  area?: boolean;
  /** Formats values in the accessible name. */
  format?: (value: number) => string;
  className?: string;
}

/**
 * A tiny trend line. It is a labelled image: pair it with the number it summarises, or offer a
 * `<Summary>` table when the exact values matter.
 */
export function Sparkline({
  data,
  label,
  width = 120,
  height = 32,
  tone = 'steel',
  min,
  max,
  threshold,
  area = false,
  format = String,
  className,
}: SparklineProps) {
  const gradient = useId();
  const geometry = sparklineGeometry({
    data,
    width,
    height,
    ...(min !== undefined ? { min } : {}),
    ...(max !== undefined ? { max } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
  });
  const last = geometry.points[geometry.points.length - 1];
  const finite = data.filter((value) => Number.isFinite(value));
  const latest = finite[finite.length - 1];
  const summary =
    latest === undefined
      ? `${label}: no data`
      : `${label}: ${finite.length} points, latest ${format(latest)}, from ${format(Math.min(...finite))} to ${format(Math.max(...finite))}`;

  return (
    <svg
      className={cx('bf-spark', className)}
      data-tone={tone}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={summary}
    >
      {area && geometry.area ? (
        <>
          <defs>
            <linearGradient id={gradient} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="var(--tone)" stopOpacity="0.28" />
              <stop offset="1" stopColor="var(--tone)" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={geometry.area} fill={`url(#${gradient})`} />
        </>
      ) : null}
      {geometry.thresholdY !== null ? (
        <line
          className="bf-spark__threshold"
          x1={0}
          x2={width}
          y1={geometry.thresholdY}
          y2={geometry.thresholdY}
        />
      ) : null}
      {geometry.line ? <path className="bf-spark__line" d={geometry.line} fill="none" /> : null}
      {last ? <circle className="bf-spark__dot" cx={last.x} cy={last.y} r={2.5} /> : null}
    </svg>
  );
}
