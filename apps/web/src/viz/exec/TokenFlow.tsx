import type { TraceEvent } from '@bigforge/schemas';
import { useMemo } from 'react';
import { Provenance, Summary, formatPct, formatTokens } from '../../ui';
import {
  type FlowLink,
  type FlowNode,
  aggregatePurposes,
  flowTable,
  layoutTokenFlow,
  linkPath,
} from './tokenflow';
import { useWidth } from './useWidth';
import './exec.css';

const MIN_WIDTH = 640;

export interface TokenFlowProps {
  /** The baseline run's events: every model call is a flow. */
  baselineEvents: readonly TraceEvent[];
  /** What the Reflex run still sent; `null` draws only where the baseline's tokens went. */
  reflex: { total: number; input: number; output: number } | null;
  /** Purposes the Reflex's boundary step replaced, from its rationale (null when unknown). */
  replacedKeys: ReadonlySet<string> | null;
}

function nodeLabel(node: FlowNode): { x: number; anchor: 'start' | 'end'; lines: string[] } {
  const gap = node.w + 8;
  if (node.column === 0) return { x: node.x - 8, anchor: 'end', lines: [node.label, node.detail] };
  if (node.column === 1)
    return {
      x: node.x + gap,
      anchor: 'start',
      lines: [`${node.label}`, node.detail.split(' \u00b7 ')[0] ?? node.detail],
    };
  return { x: node.x + gap, anchor: 'start', lines: [node.label, node.detail] };
}

export function TokenFlow({ baselineEvents, reflex, replacedKeys }: TokenFlowProps) {
  const [ref, measured] = useWidth();
  const purposes = useMemo(() => aggregatePurposes(baselineEvents), [baselineEvents]);
  const width = Math.max(MIN_WIDTH, measured ?? 860);
  const height = Math.max(300, Math.min(420, 120 + purposes.length * 26));
  const layout = useMemo(
    () => layoutTokenFlow({ baseline: purposes, reflex, replacedKeys }, { width, height }),
    [purposes, reflex, replacedKeys, width, height],
  );
  const table = useMemo(
    () => flowTable(purposes, reflex ? reflex.total : null, replacedKeys),
    [purposes, reflex, replacedKeys],
  );
  const totals = useMemo(
    () => ({
      uncached: purposes.reduce((sum, row) => sum + row.uncachedInput, 0),
      cached: purposes.reduce((sum, row) => sum + row.cachedInput, 0),
      output: purposes.reduce((sum, row) => sum + row.output, 0),
    }),
    [purposes],
  );

  if (layout.empty) {
    return (
      <div className="ex-flow ex-flow--empty" data-testid="token-flow">
        <p className="dim">The baseline run made no model calls, so no tokens flowed.</p>
      </div>
    );
  }

  const share = layout.baselineTotal > 0 ? layout.avoided / layout.baselineTotal : 0;
  const ariaLabel = reflex
    ? `Token flow. The baseline spent ${formatTokens(layout.baselineTotal)} synthetic tokens across ${purposes.length} purposes. BigForge still sent ${formatTokens(layout.sent)} at the boundary and avoided ${formatTokens(layout.avoided)}.`
    : `Token flow. The baseline spent ${formatTokens(layout.baselineTotal)} synthetic tokens across ${purposes.length} purposes.`;

  return (
    <div className="ex-flow" data-testid="token-flow">
      <div className="ex-flow__facts">
        <p className="ex-flow__fact">
          <span className="micro">Baseline spent</span>
          <strong className="num ex-flow__num" data-tone="ember">
            {formatTokens(layout.baselineTotal)}
          </strong>
          <span className="dim">tokens</span>
          <Provenance kind="synthetic" metric="tokens_per_task" />
        </p>
        {reflex ? (
          <>
            <p className="ex-flow__fact">
              <span className="micro">Still sent at the boundary</span>
              <strong className="num ex-flow__num" data-tone="molten">
                {formatTokens(layout.sent)}
              </strong>
              <span className="dim">tokens</span>
              <Provenance kind="synthetic" metric="tokens_per_task" />
            </p>
            <p className="ex-flow__fact">
              <span className="micro">Avoided</span>
              <strong className="num ex-flow__num" data-tone="steel">
                {formatTokens(layout.avoided)}
              </strong>
              <span className="dim">tokens ({formatPct(share, { digits: 1 })})</span>
              <Provenance kind={['synthetic', 'estimated']} />
            </p>
          </>
        ) : null}
      </div>

      <div className="ex-flow__scroll" ref={ref}>
        <svg
          className="ex-flow__svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label={ariaLabel}
          focusable="false"
        >
          <g className="ex-flow__links">
            {layout.links.map((link: FlowLink) => (
              <path
                key={link.id}
                className="ex-link"
                data-tone={link.tone}
                data-pattern={link.pattern}
                data-estimated={link.estimated ? 'true' : undefined}
                d={linkPath(link)}
                strokeWidth={link.thickness}
              >
                <title>{`${link.from.replace(/^(type|purpose|out):/, '')} to ${link.to.replace(/^(type|purpose|out):/, '')}: ${formatTokens(link.value)} tokens${link.estimated ? ' (estimated allocation)' : ''}`}</title>
              </path>
            ))}
          </g>
          <g className="ex-flow__nodes">
            {layout.nodes.map((node) => {
              const label = nodeLabel(node);
              const lineHeight = node.column === 1 ? 0 : 13;
              const top =
                node.y + node.h / 2 - (label.lines.length > 1 && node.column !== 1 ? 13 : 0) + 4;
              return (
                <g
                  key={node.id}
                  className="ex-node"
                  data-tone={node.tone}
                  data-pattern={node.pattern}
                >
                  <rect
                    x={node.x}
                    y={node.y}
                    width={node.w}
                    height={node.h}
                    rx={2}
                    className="ex-node__bar"
                  />
                  <text x={label.x} y={top} textAnchor={label.anchor} className="ex-node__text">
                    {node.column === 1 ? (
                      <>
                        <tspan className="ex-node__label">{label.lines[0]}</tspan>
                        <tspan className="ex-node__value" dx={8}>
                          {label.lines[1]}
                        </tspan>
                      </>
                    ) : (
                      <>
                        <tspan className="ex-node__label" x={label.x}>
                          {label.lines[0]}
                        </tspan>
                        <tspan className="ex-node__value" x={label.x} dy={lineHeight}>
                          {label.lines[1]}
                        </tspan>
                      </>
                    )}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <ul className="ex-flow__legend" aria-label="Legend">
        <li>
          <span className="ex-key" data-tone="ember" data-pattern="solid" />
          Uncached input ({formatTokens(totals.uncached)})
        </li>
        <li>
          <span className="ex-key" data-tone="ember" data-pattern="dots" />
          Cached input ({formatTokens(totals.cached)})
        </li>
        <li>
          <span className="ex-key" data-tone="ember" data-pattern="stripes" />
          Output ({formatTokens(totals.output)})
        </li>
        {reflex ? (
          <>
            <li>
              <span className="ex-key" data-tone="steel" data-pattern="solid" />
              Avoided: replaced by local steps
            </li>
            <li>
              <span className="ex-key" data-tone="molten" data-pattern="solid" />
              Still sent: the boundary call
            </li>
          </>
        ) : null}
      </ul>
      <p className="ex-flow__note">
        Token counts come from the deterministic provider (synthetic).
        {reflex
          ? layout.basis === 'replaced_steps'
            ? ' The Reflex made one call, so the tokens it still sent are placed on the baseline purposes its boundary step replaced, in proportion to their tokens. That placement is an estimate.'
            : layout.basis === 'proportional'
              ? ' The Reflex made one call; no step names the purposes it replaced, so the tokens it still sent are spread across all purposes in proportion. That placement is an estimate.'
              : ' The Reflex made no model call, so nothing was sent.'
          : ''}
        {layout.overspend > 0
          ? ` The Reflex run spent ${formatTokens(layout.overspend)} more tokens than the baseline.`
          : ''}
      </p>

      <Summary
        description={
          reflex
            ? `The baseline's ${formatTokens(layout.baselineTotal)} synthetic tokens by purpose, and how much of each BigForge still sent (estimated placement) or avoided.`
            : `The baseline's ${formatTokens(layout.baselineTotal)} synthetic tokens by purpose.`
        }
        caption="Tokens by purpose"
        columns={[
          { id: 'purpose', header: 'Purpose', cell: (row) => row.label },
          { id: 'calls', header: 'Calls', cell: (row) => row.calls, align: 'end', mono: true },
          {
            id: 'uncached',
            header: 'Uncached in',
            cell: (row) => formatTokens(row.uncachedInput),
            align: 'end',
            mono: true,
          },
          {
            id: 'cached',
            header: 'Cached in',
            cell: (row) => formatTokens(row.cachedInput),
            align: 'end',
            mono: true,
          },
          {
            id: 'output',
            header: 'Output',
            cell: (row) => formatTokens(row.output),
            align: 'end',
            mono: true,
          },
          {
            id: 'total',
            header: 'Total',
            cell: (row) => formatTokens(row.total),
            align: 'end',
            mono: true,
          },
          ...(reflex
            ? [
                {
                  id: 'sent',
                  header: 'Still sent (est.)',
                  cell: (row: (typeof table)[number]) => formatTokens(Math.round(row.kept)),
                  align: 'end' as const,
                  mono: true,
                },
                {
                  id: 'avoided',
                  header: 'Avoided (est.)',
                  cell: (row: (typeof table)[number]) => formatTokens(Math.round(row.avoided)),
                  align: 'end' as const,
                  mono: true,
                },
              ]
            : []),
        ]}
        rows={table}
        getRowId={(row) => row.key}
      />
    </div>
  );
}
