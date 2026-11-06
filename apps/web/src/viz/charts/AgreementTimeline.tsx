import { type TimelineModel, linesCoincide } from './agreementTimeline';
import { linearScale, niceTicks, polylinePath } from './scale';
import { useMeasuredWidth } from './useMeasuredWidth';
import './charts.css';

export interface AgreementTimelineProps {
  model: TimelineModel;
  ariaLabel: string;
  height?: number;
}

const MARGIN = { top: 34, right: 168, bottom: 84, left: 46 };
const MIN_WIDTH = 660;

const pct = (value: number): string => `${Math.round(value * 100)}%`;

/**
 * Agreement between the Reflex and the baseline over time: the running shadow agreement that earned
 * trust, then the running canary agreement after the world changed, against the floor and the maximum
 * drop the drift verdict is judged by. Every comparison is also a check or a cross on the tape below.
 */
export function AgreementTimeline({ model, ariaLabel, height = 340 }: AgreementTimelineProps) {
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const W = Math.max(width, MIN_WIDTH);
  const H = height;
  const plotW = W - MARGIN.left - MARGIN.right;
  const plotH = H - MARGIN.top - MARGIN.bottom;
  const x = linearScale([0, model.xMax], [0, plotW]);
  const y = linearScale([model.yMin, 1], [plotH, 0]);
  const yTicks = niceTicks(model.yMin, 1, 5);
  const coincide = linesCoincide(model);

  const shadow = model.groups.find((group) => group.kind === 'shadow');
  const canaries = model.groups.filter((group) => group.kind === 'canary');
  const latest = [...model.groups].reverse().find((group) => group.verdict);
  const latestLast = latest?.points[latest.points.length - 1];
  const verdict = latest?.verdict ?? null;
  const tapeY = plotH + 22;
  // Sit the drop label just above the arrow tip, and step it clear of the floor label when they would touch.
  const rawDropY = verdict ? y(verdict.currentAgreement) - 34 : 0;
  const dropLabelY = Math.abs(rawDropY - y(model.floor)) < 16 ? y(model.floor) + 20 : rawDropY;

  const linePath = (points: { x: number; running: number }[]) =>
    polylinePath(points.map((p) => ({ x: x(p.x), y: y(p.running) })));

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
          <g transform={`translate(${MARGIN.left} ${MARGIN.top})`}>
            <rect
              className="bf-tl__below"
              x="0"
              y={y(model.floor)}
              width={plotW}
              height={Math.max(0, plotH - y(model.floor))}
            />
            {yTicks.map((tick) => (
              <g key={tick}>
                <line className="bf-chart__grid" x1="0" x2={plotW} y1={y(tick)} y2={y(tick)} />
                <text
                  className="bf-chart__tick"
                  x="-10"
                  y={y(tick)}
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {pct(tick)}
                </text>
              </g>
            ))}
            <text className="bf-chart__axis-title" x="-46" y="-16" textAnchor="start">
              Agreement with the baseline
            </text>

            <line
              className="bf-tl__floor"
              x1="0"
              x2={plotW}
              y1={y(model.floor)}
              y2={y(model.floor)}
            />
            {model.dropLine !== null && !coincide ? (
              <line
                className="bf-tl__drop"
                x1="0"
                x2={plotW}
                y1={y(model.dropLine)}
                y2={y(model.dropLine)}
              />
            ) : null}
            <text
              className="bf-tl__threshold"
              x={plotW + 8}
              y={y(model.floor) + (coincide ? 0 : -1)}
              dominantBaseline="central"
            >
              {coincide
                ? `floor ${pct(model.floor)} \u00b7 max drop ${Math.round(model.dropThreshold * 100)} pts`
                : `floor ${pct(model.floor)}`}
            </text>
            {model.dropLine !== null && !coincide ? (
              <text
                className="bf-tl__threshold"
                x={plotW + 8}
                y={y(model.dropLine) + 13}
                dominantBaseline="central"
              >
                {`max drop ${Math.round(model.dropThreshold * 100)} pts`}
              </text>
            ) : null}

            {model.environmentMarker ? (
              <g aria-hidden="true">
                <line
                  className="bf-tl__marker"
                  x1={x(model.environmentMarker.x)}
                  x2={x(model.environmentMarker.x)}
                  y1="-8"
                  y2={plotH + 40}
                />
                <text
                  className="bf-tl__marker-label"
                  x={x(model.environmentMarker.x)}
                  y="-14"
                  textAnchor="middle"
                >
                  {model.environmentMarker.label}
                </text>
              </g>
            ) : null}

            {model.historic !== null && latestLast ? (
              <line
                className="bf-tl__historic"
                x1={x(shadow?.points[shadow.points.length - 1]?.x ?? 0)}
                x2={x(latestLast.x) + 56}
                y1={y(model.historic)}
                y2={y(model.historic)}
              />
            ) : null}

            {shadow ? (
              <g>
                <path className="bf-tl__line bf-tl__line--shadow" d={linePath(shadow.points)} />
                {shadow.points.map((p) => (
                  <circle
                    key={p.index}
                    className="bf-tl__dot bf-tl__dot--shadow"
                    cx={x(p.x)}
                    cy={y(p.running)}
                    r="3.5"
                  />
                ))}
              </g>
            ) : null}
            {canaries.map((group) => (
              <g key={group.id}>
                <path className="bf-tl__line bf-tl__line--canary" d={linePath(group.points)} />
                {group.points.map((p) => (
                  <circle
                    key={p.index}
                    className={`bf-tl__dot bf-tl__dot--canary${p.agree ? '' : ' bf-tl__dot--miss'}`}
                    cx={x(p.x)}
                    cy={y(p.running)}
                    r="3.5"
                  />
                ))}
              </g>
            ))}

            {verdict && latestLast ? (
              <g aria-hidden="true">
                <line
                  className="bf-tl__ibeam"
                  x1={x(latestLast.x) + 12}
                  x2={x(latestLast.x) + 12}
                  y1={y(verdict.interval.high)}
                  y2={y(verdict.interval.low)}
                />
                <line
                  className="bf-tl__ibeam"
                  x1={x(latestLast.x) + 8}
                  x2={x(latestLast.x) + 16}
                  y1={y(verdict.interval.high)}
                  y2={y(verdict.interval.high)}
                />
                <line
                  className="bf-tl__ibeam"
                  x1={x(latestLast.x) + 8}
                  x2={x(latestLast.x) + 16}
                  y1={y(verdict.interval.low)}
                  y2={y(verdict.interval.low)}
                />
                <line
                  className="bf-tl__drop-arrow"
                  x1={x(latestLast.x) + 38}
                  x2={x(latestLast.x) + 38}
                  y1={y(verdict.historicAgreement)}
                  y2={y(verdict.currentAgreement) - 6}
                />
                <path
                  className="bf-tl__drop-head"
                  d={`M${x(latestLast.x) + 33} ${y(verdict.currentAgreement) - 8} l5 8 l5 -8 Z`}
                />
                <text
                  className="bf-tl__annot"
                  x={x(latestLast.x) + 50}
                  y={dropLabelY}
                  dominantBaseline="central"
                >
                  {verdict.drop > 0 ? `${Math.round(verdict.drop * 100)} points lower` : 'no drop'}
                </text>
                <text
                  className="bf-tl__annot bf-tl__annot--faint"
                  x={x(latestLast.x) + 50}
                  y={dropLabelY + 15}
                  dominantBaseline="central"
                >
                  {`${pct(verdict.historicAgreement)} to ${pct(verdict.currentAgreement)}`}
                </text>
                <text
                  className="bf-tl__annot bf-tl__annot--faint"
                  x={x(latestLast.x) + 12}
                  y={y(verdict.interval.low) + 14}
                  textAnchor="middle"
                >
                  90% interval
                </text>
                <text
                  className="bf-tl__annot bf-tl__annot--faint"
                  x={x(latestLast.x) + 12}
                  y={y(verdict.interval.low) + 28}
                  textAnchor="middle"
                >
                  {`${pct(verdict.interval.low)} to ${pct(verdict.interval.high)}`}
                </text>
              </g>
            ) : null}

            <g aria-hidden="true">
              {model.points.map((p) => (
                <g
                  key={p.index}
                  transform={`translate(${x(p.x)} ${tapeY})`}
                  className={
                    p.agree ? 'bf-tl__tape bf-tl__tape--agree' : 'bf-tl__tape bf-tl__tape--miss'
                  }
                >
                  {p.agree ? (
                    <path d="M-4 0 L-1.5 3 L4 -3.5" />
                  ) : (
                    <path d="M-3.5 -3.5 L3.5 3.5 M3.5 -3.5 L-3.5 3.5" />
                  )}
                </g>
              ))}
              {model.groups.map((group) => {
                const first = group.points[0];
                const last = group.points[group.points.length - 1];
                if (!first || !last) return null;
                const agreed = group.points.filter((p) => p.agree).length;
                return (
                  <g key={group.id} transform={`translate(0 ${tapeY + 16})`}>
                    <line
                      className="bf-tl__bracket"
                      x1={x(first.x) - 6}
                      x2={x(last.x) + 6}
                      y1="0"
                      y2="0"
                    />
                    <text
                      className="bf-tl__group"
                      x={(x(first.x) + x(last.x)) / 2}
                      y="16"
                      textAnchor="middle"
                    >
                      {`${group.title} \u00b7 ${agreed} of ${group.points.length} agreed`}
                    </text>
                  </g>
                );
              })}
            </g>
          </g>
        </svg>
      </div>
    </div>
  );
}
