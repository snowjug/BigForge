import { useId } from 'react';
import { barSpan, type WaterfallBar, type WaterfallLayout } from './waterfall';
import { linearScale } from './scale';
import { useMeasuredWidth } from './useMeasuredWidth';
import './charts.css';

export interface InvestmentWaterfallProps {
  layout: WaterfallLayout;
  /** Formats a value in the unit being drawn (tokens or dollars). */
  format: (value: number) => string;
  ariaLabel: string;
  /** What to call a line the report does not count. */
  excludedNote?: string;
}

const ROW = 46;
const LABEL_W = 190;
const VALUE_W = 128;
const MIN_WIDTH = 520;

const TONE: Record<string, 'ember' | 'steel' | 'teal' | 'amber'> = {
  shadow: 'ember',
  canary: 'ember',
  learning: 'ember',
  compile: 'steel',
  replay: 'teal',
  review: 'amber',
};

/** Provenance as words the reader recognises; the badge style lives in the UI kit, this is the compact text. */
const PROVENANCE_TEXT: Record<string, string> = {
  measured: 'measured',
  synthetic: 'synthetic',
  simulated: 'simulated',
  estimated: 'estimated',
  'replay-measured': 'replay-measured',
  mixed: 'mixed provenance',
};

function barTone(bar: WaterfallBar): string {
  if (bar.kind === 'total') return 'total';
  return TONE[bar.id] ?? 'steel';
}

/**
 * The investment as a ledger waterfall: each counted line starts where the last one ended and the total
 * closes it; a line the report does not count hangs after the total as a dashed ghost. Every row names
 * its provenance, so tokens, dollars and assumptions are never blended.
 */
export function InvestmentWaterfall({
  layout,
  format,
  ariaLabel,
  excludedNote,
}: InvestmentWaterfallProps) {
  const uid = useId().replace(/:/g, '');
  const { ref, width } = useMeasuredWidth<HTMLDivElement>();
  const W = Math.max(width, MIN_WIDTH);
  const barW = Math.max(80, W - LABEL_W - VALUE_W - 12);
  const H = layout.bars.length * ROW + 12;
  const x = linearScale([0, layout.domainMax], [0, barW]);
  const rowCenter = (index: number): number => 6 + index * ROW + ROW / 2;

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
              <rect className="bf-wf__hatch-bg" width="6" height="6" />
              <line className="bf-chart__hatch-line" x1="0" y1="0" x2="0" y2="6" />
            </pattern>
          </defs>
          <g transform={`translate(${LABEL_W} 0)`}>
            <line className="bf-chart__grid" x1="0" x2="0" y1="0" y2={H} />
          </g>
          {layout.bars.map((bar, index) => {
            const cy = rowCenter(index);
            const span = barSpan(bar, x, 2);
            const next = layout.bars[index + 1];
            const tone = barTone(bar);
            const excluded = bar.kind === 'excluded';
            const total = bar.kind === 'total';
            return (
              <g key={bar.id} className="bf-wf__row" data-kind={bar.kind}>
                {bar.note ? <title>{`${bar.label}: ${bar.note}`}</title> : null}
                <text
                  className={total ? 'bf-wf__label bf-wf__label--total' : 'bf-wf__label'}
                  x="0"
                  y={cy - (total ? 1 : 7)}
                  dominantBaseline="central"
                >
                  {bar.label}
                </text>
                {total ? null : (
                  <text className="bf-wf__sub" x="0" y={cy + 9} dominantBaseline="central">
                    {PROVENANCE_TEXT[bar.provenance] ?? bar.provenance}
                    {bar.runs > 0 ? ` \u00b7 ${bar.runs} ${bar.runs === 1 ? 'run' : 'runs'}` : ''}
                  </text>
                )}
                <g transform={`translate(${LABEL_W} 0)`}>
                  <rect
                    className={`bf-wf__bar bf-wf__bar--${tone}${excluded ? ' bf-wf__bar--excluded' : ''}`}
                    x={span.x}
                    y={cy - 11}
                    width={span.width}
                    height="22"
                    rx="3"
                    {...(tone === 'amber' && !excluded ? { fill: `url(#${uid}-hatch)` } : {})}
                  />
                  {next && !excluded && next.kind !== 'excluded' ? (
                    <line
                      className="bf-wf__connector"
                      x1={x(bar.end)}
                      x2={x(next.kind === 'total' ? bar.end : next.start)}
                      y1={cy + 11}
                      y2={rowCenter(index + 1) - 11}
                    />
                  ) : null}
                </g>
                <text
                  className={total ? 'bf-wf__value bf-wf__value--total' : 'bf-wf__value'}
                  x={W - 4}
                  y={cy - 7}
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {excluded ? '+' : ''}
                  {format(bar.value)}
                </text>
                <text
                  className="bf-wf__sub"
                  x={W - 4}
                  y={cy + 9}
                  textAnchor="end"
                  dominantBaseline="central"
                >
                  {excluded
                    ? (excludedNote ?? 'not counted')
                    : total
                      ? 'counted'
                      : bar.value === 0
                        ? bar.id === 'review'
                          ? 'time, shown in dollars'
                          : 'none'
                        : `${Math.round(bar.share * 100)}% of total`}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
