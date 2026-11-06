import { useId } from 'react';
import {
  type BreakEvenGeometry,
  type SeriesPoint,
  valueAt,
  wholeExecutions,
  xsBetween,
  yDomainMax,
} from './breakEven';
import { bandPath, linearScale, niceTicks, polylinePath } from './scale';
import { useMeasuredWidth } from './useMeasuredWidth';
import './charts.css';

export interface BreakEvenChartProps {
  series: readonly SeriesPoint[];
  geometry: BreakEvenGeometry;
  /** The visible executions range (see chartWindow). */
  xMax: number;
  /** Live executions so far: the realized region (solid) ends here, the projection (dashed) continues. */
  liveExecutions: number;
  /** The report's break-even, drawn as a diamond on the axis when it differs from the plotted crossing. */
  reportedBreakEven: number | null;
  showReported: boolean;
  /** Compact axis numbers: (1250000) -> "1.25M". */
  formatAxis: (value: number) => string;
  formatValue: (value: number) => string;
  ariaLabel: string;
  height?: number;
}

const MARGIN = { top: 48, right: 118, bottom: 48, left: 58 };
const MIN_WIDTH = 600;

/**
 * Cumulative tokens against executions: the baseline pays per execution, BigForge pays its investment up
 * front, both on the basis of the measured executions behind the headline saving. Solid is realized (what
 * the demo ran), dashed is projected; the hatched band is the 95% interval of the per-execution saving;
 * the flag marks where the plotted lines cross, rounded up to a whole execution like the report.
 */
export function BreakEvenChart({
  series,
  geometry,
  xMax,
  liveExecutions,
  reportedBreakEven,
  showReported,
  formatAxis,
  formatValue,
  ariaLabel,
  height = 340,
}: BreakEvenChartProps) {
  const uid = useId().replace(/:/g, '');
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const W = Math.max(width, MIN_WIDTH);
  const H = height;
  const plotW = W - MARGIN.left - MARGIN.right;
  const plotH = H - MARGIN.top - MARGIN.bottom;
  const yMax = yDomainMax(geometry, xMax);
  const x = linearScale([0, xMax], [0, plotW]);
  const y = linearScale([0, yMax], [plotH, 0]);

  const live = Math.min(Math.max(liveExecutions, 0), xMax);
  const path = (key: 'baselineCumulative' | 'bigforgeCumulative', from: number, to: number) =>
    polylinePath(
      xsBetween(series, from, to).map((at) => ({ x: x(at), y: y(valueAt(series, key, at)) })),
    );

  const edge = (sign: 1 | -1) =>
    xsBetween(series, 0, xMax).map((at) => ({
      x: x(at),
      y: y(Math.max(0, valueAt(series, 'baselineCumulative', at) + sign * geometry.halfSlope * at)),
    }));
  const band = geometry.halfSlope > 0 ? bandPath(edge(1), edge(-1)) : '';

  const xTicks = niceTicks(0, xMax, Math.max(3, Math.floor(plotW / 110)));
  const yTicks = niceTicks(0, yMax, 5);

  const baselineEnd = y(valueAt(series, 'baselineCumulative', xMax));
  const bigforgeEnd = y(valueAt(series, 'bigforgeCumulative', xMax));
  // Direct labels sit at the right ends of the lines; nudge them apart when the lines end close together.
  const [baselineLabelY, bigforgeLabelY] =
    Math.abs(baselineEnd - bigforgeEnd) < 34
      ? baselineEnd <= bigforgeEnd
        ? [baselineEnd - 10, bigforgeEnd + 14]
        : [baselineEnd + 14, bigforgeEnd - 10]
      : [baselineEnd, bigforgeEnd];

  const crossing =
    geometry.crossing !== null && geometry.crossing <= xMax ? geometry.crossing : null;
  const crossingY = crossing === null ? 0 : y(valueAt(series, 'bigforgeCumulative', crossing));
  const interval = geometry.crossingInterval;
  const flagLeft = crossing !== null && x(crossing) > plotW - 230;
  const realizedWidth = live > 0 ? Math.max(4, x(live)) : 0;

  return (
    <div className="bf-chart" ref={ref}>
      <div className="bf-chart__scroll">
        <svg
          className="bf-chart__svg"
          width={W}
          height={H}
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={ariaLabel}
        >
          <defs>
            <pattern
              id={`${uid}-hatch`}
              width="6"
              height="6"
              patternUnits="userSpaceOnUse"
              patternTransform="rotate(45)"
            >
              <line className="bf-chart__hatch-line" x1="0" y1="0" x2="0" y2="6" />
            </pattern>
            <clipPath id={`${uid}-plot`}>
              <rect x="0" y="-2" width={plotW} height={plotH + 4} />
            </clipPath>
          </defs>
          <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
            {yTicks.map((tick) => (
              <g key={`y${tick}`}>
                <line className="bf-chart__grid" x1="0" x2={plotW} y1={y(tick)} y2={y(tick)} />
                <text
                  className="bf-chart__tick"
                  x="-10"
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {formatAxis(tick)}
                </text>
              </g>
            ))}
            <text className="bf-chart__axis-title" x="-58" y="-32" textAnchor="start">
              Cumulative tokens (synthetic)
            </text>

            <g clipPath={`url(#${uid}-plot)`}>
              {live > 0 ? (
                <rect
                  className="bf-chart__realized"
                  x="0"
                  y="0"
                  width={realizedWidth}
                  height={plotH}
                />
              ) : null}
              {live > 0 ? (
                <text className="bf-chart__realized-label" x={realizedWidth + 6} y="14">
                  realized
                </text>
              ) : null}
              {band ? (
                <path className="bf-chart__band" d={band} fill={`url(#${uid}-hatch)`} />
              ) : null}
              <path
                className="bf-chart__line bf-chart__line--baseline bf-chart__line--projected"
                d={path('baselineCumulative', live, xMax)}
              />
              <path
                className="bf-chart__line bf-chart__line--bigforge bf-chart__line--projected"
                d={path('bigforgeCumulative', live, xMax)}
              />
              {live > 0 ? (
                <>
                  <path
                    className="bf-chart__line bf-chart__line--baseline"
                    d={path('baselineCumulative', 0, live)}
                  />
                  <path
                    className="bf-chart__line bf-chart__line--bigforge"
                    d={path('bigforgeCumulative', 0, live)}
                  />
                </>
              ) : null}
            </g>

            <line className="bf-chart__axis" x1="0" x2={plotW} y1={plotH} y2={plotH} />
            {xTicks.map((tick) => (
              <g key={`x${tick}`}>
                <line
                  className="bf-chart__axis"
                  x1={x(tick)}
                  x2={x(tick)}
                  y1={plotH}
                  y2={plotH + 5}
                />
                <text className="bf-chart__tick" x={x(tick)} y={plotH + 19} textAnchor="middle">
                  {formatAxis(tick)}
                </text>
              </g>
            ))}
            <text className="bf-chart__axis-title" x={plotW} y={plotH + 40} textAnchor="end">
              Executions
            </text>

            {interval && interval.low <= xMax ? (
              <g aria-hidden="true">
                <line
                  className="bf-chart__interval"
                  x1={x(interval.low)}
                  x2={x(Math.min(interval.high ?? xMax, xMax))}
                  y1={plotH}
                  y2={plotH}
                />
                <line
                  className="bf-chart__interval-cap"
                  x1={x(interval.low)}
                  x2={x(interval.low)}
                  y1={plotH - 5}
                  y2={plotH + 5}
                />
                {interval.high !== null && interval.high <= xMax ? (
                  <line
                    className="bf-chart__interval-cap"
                    x1={x(interval.high)}
                    x2={x(interval.high)}
                    y1={plotH - 5}
                    y2={plotH + 5}
                  />
                ) : null}
              </g>
            ) : null}

            {showReported && reportedBreakEven !== null && reportedBreakEven <= xMax ? (
              <g aria-hidden="true">
                <path
                  className="bf-chart__diamond"
                  d={`M${x(reportedBreakEven)} ${plotH - 22} l5 7 l-5 7 l-5 -7 Z`}
                />
              </g>
            ) : null}

            {crossing !== null ? (
              <g aria-hidden="true">
                <line
                  className="bf-chart__flag-rule"
                  x1={x(crossing)}
                  x2={x(crossing)}
                  y1={-6}
                  y2={plotH}
                />
                <circle className="bf-chart__crossing" cx={x(crossing)} cy={crossingY} r="5.5" />
                <text
                  className="bf-chart__flag"
                  x={x(crossing) + (flagLeft ? -8 : 8)}
                  y="-8"
                  textAnchor={flagLeft ? 'end' : 'start'}
                >
                  Lines cross at about {wholeExecutions(crossing)} executions
                  {interval
                    ? ` (${wholeExecutions(interval.low)} to ${interval.high === null ? 'never' : wholeExecutions(interval.high)})`
                    : ''}
                </text>
              </g>
            ) : null}

            <text
              className="bf-chart__end bf-chart__end--baseline"
              x={plotW + 10}
              y={baselineLabelY}
              dominantBaseline="central"
            >
              Baseline
              <tspan x={plotW + 10} dy="14" className="bf-chart__end-value">
                {formatValue(valueAt(series, 'baselineCumulative', xMax))}
              </tspan>
            </text>
            <text
              className="bf-chart__end bf-chart__end--bigforge"
              x={plotW + 10}
              y={bigforgeLabelY}
              dominantBaseline="central"
            >
              BigForge
              <tspan x={plotW + 10} dy="14" className="bf-chart__end-value">
                {formatValue(valueAt(series, 'bigforgeCumulative', xMax))}
              </tspan>
            </text>
          </g>
        </svg>
      </div>
    </div>
  );
}
