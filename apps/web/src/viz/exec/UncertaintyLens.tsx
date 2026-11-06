import type { BoundaryResolution } from '@bigforge/schemas';
import {
  ArrowRight,
  Ban,
  CircleCheck,
  CircleX,
  ChevronRight,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { useDemoTarget } from '../../demo/useDemo';
import {
  Chip,
  Provenance,
  Summary,
  TabPanel,
  Tabs,
  cx,
  formatMs,
  formatPct,
  formatTokens,
} from '../../ui';
import { type LensChunk, layoutLens, outcomeInfo, verdictPath, withheldRatio } from './lens';
import { useWidth } from './useWidth';
import './exec.css';

const MIN_WIDTH = 640;
const HEIGHT = 300;

function ScreeningChip({ chunk }: { chunk: LensChunk }) {
  if (chunk.screening === 'redacted') {
    return (
      <Chip
        tone="amber"
        variant="outline"
        size="sm"
        icon={<ShieldCheck size={11} />}
        title={chunk.screeningDetail ?? undefined}
      >
        secret redacted
      </Chip>
    );
  }
  if (chunk.screening === 'instruction_like') {
    return (
      <Chip
        tone="crimson"
        variant="outline"
        size="sm"
        icon={<ShieldAlert size={11} />}
        title={chunk.screeningDetail ?? undefined}
      >
        instruction-like
      </Chip>
    );
  }
  return null;
}

/** A bubble label fits when its text is narrower than the bubble. */
const fits = (text: string, r: number): boolean => text.length * 6.3 + 6 <= r * 2;

function LensPicture({
  boundary,
  chunks,
}: {
  boundary: BoundaryResolution;
  chunks: ReturnType<typeof layoutLens>;
}) {
  const clipId = useId().replace(/[^a-zA-Z0-9_-]/g, '_');
  const { lens, blobBox } = chunks;
  const selected = chunks.chunks.filter((chunk) => chunk.state === 'selected');
  const rejected = chunks.chunks.filter((chunk) => chunk.state === 'rejected');
  const edge = blobBox.x + blobBox.w;
  const funnelTop = lens.cy - lens.r * 0.62;
  const funnelBottom = lens.cy + lens.r * 0.62;
  const funnelX = lens.cx - lens.r * 0.79;
  const mid = (edge + funnelX) / 2;
  return (
    <svg
      className="ex-lens__svg"
      width={chunks.width}
      height={chunks.height}
      viewBox={`0 0 ${chunks.width} ${chunks.height}`}
      role="img"
      aria-label={`Uncertainty lens. The run observed ${formatTokens(chunks.observedTokens)} tokens of evidence in ${chunks.chunks.length} chunks. The Token Firewall let ${selected.length} chunks through, ${formatTokens(chunks.selectedTokens)} tokens.`}
      focusable="false"
    >
      <defs>
        <filter id={`${clipId}-glow`} x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="6" />
        </filter>
      </defs>

      <rect
        className="ex-lens__region"
        x={blobBox.x}
        y={blobBox.y}
        width={blobBox.w}
        height={blobBox.h}
        rx={10}
      />
      <text className="ex-lens__caption" x={blobBox.x + 12} y={blobBox.y + 18}>
        Observed: {chunks.chunks.length} chunks, {formatTokens(chunks.observedTokens)} tokens
      </text>

      <g aria-hidden="true">
        <path
          className="ex-lens__funnel"
          d={`M${edge} ${blobBox.y + 26} C${mid} ${blobBox.y + 26} ${mid} ${funnelTop} ${funnelX} ${funnelTop}`}
        />
        <path
          className="ex-lens__funnel"
          d={`M${edge} ${blobBox.y + blobBox.h - 26} C${mid} ${blobBox.y + blobBox.h - 26} ${mid} ${funnelBottom} ${funnelX} ${funnelBottom}`}
        />
        <text className="ex-lens__gate" x={mid} y={lens.cy - 4} textAnchor="middle">
          Token Firewall
        </text>
        <text
          className="ex-lens__gate ex-lens__gate--sub"
          x={mid}
          y={lens.cy + 14}
          textAnchor="middle"
        >{`${rejected.length} withheld, ${selected.length} pass`}</text>
      </g>

      <g className="ex-lens__blob">
        {rejected.map((chunk) => (
          <g key={chunk.id} className="ex-bubble" data-state="rejected">
            <circle cx={chunk.blob.cx} cy={chunk.blob.cy} r={chunk.blob.r} />
            <title>{`${chunk.id} ${chunk.source}: ${formatTokens(chunk.tokens)} tokens. Withheld: ${chunk.reason}`}</title>
            {chunk.blob.r >= 14 ? (
              <text
                x={chunk.blob.cx}
                y={chunk.blob.cy + (fits(chunk.name, chunk.blob.r) ? -2 : 4)}
                textAnchor="middle"
                className="ex-bubble__text"
              >
                {fits(chunk.name, chunk.blob.r) ? (
                  <>
                    <tspan x={chunk.blob.cx}>{chunk.name}</tspan>
                    <tspan x={chunk.blob.cx} dy={13}>
                      {formatTokens(chunk.tokens)}
                    </tspan>
                  </>
                ) : (
                  formatTokens(chunk.tokens)
                )}
              </text>
            ) : null}
          </g>
        ))}
        {selected.map((chunk) => (
          <g key={chunk.id} className="ex-ghost">
            <circle
              className="ex-bubble__ghost"
              cx={chunk.blob.cx}
              cy={chunk.blob.cy}
              r={chunk.blob.r + 2.5}
            >
              <title>{`${chunk.id} ${chunk.source}: ${formatTokens(chunk.tokens)} tokens. Selected (number ${chunk.n ?? ''}).`}</title>
            </circle>
            <circle
              className="ex-ghost__tag"
              cx={chunk.blob.cx + chunk.blob.r + 6}
              cy={chunk.blob.cy - chunk.blob.r - 6}
              r={8}
            />
            <text
              className="ex-ghost__num"
              x={chunk.blob.cx + chunk.blob.r + 6}
              y={chunk.blob.cy - chunk.blob.r - 2}
              textAnchor="middle"
            >
              {chunk.n}
            </text>
          </g>
        ))}
      </g>

      <g className="ex-lens__ring-group">
        <circle
          className="ex-lens__glow"
          cx={lens.cx}
          cy={lens.cy}
          r={lens.r}
          filter={`url(#${clipId}-glow)`}
        />
        <circle className="ex-lens__disc" cx={lens.cx} cy={lens.cy} r={lens.r} />
        <circle className="ex-lens__ring" cx={lens.cx} cy={lens.cy} r={lens.r} />
        {selected.map((chunk) =>
          chunk.lens ? (
            <g key={chunk.id} className="ex-bubble" data-state="selected">
              <circle cx={chunk.lens.cx} cy={chunk.lens.cy} r={chunk.lens.r} />
              <title>{`${chunk.n ?? ''}: ${chunk.id} ${chunk.source}, ${formatTokens(chunk.tokens)} tokens. Sent to the model: ${chunk.reason}`}</title>
              <text
                x={chunk.lens.cx}
                y={chunk.lens.cy + (chunk.lens.r >= 18 ? -2 : 4)}
                textAnchor="middle"
                className="ex-bubble__text ex-bubble__text--lens"
              >
                <tspan x={chunk.lens.cx} className="ex-bubble__n">
                  {chunk.n}
                </tspan>
                {chunk.lens.r >= 18 ? (
                  <tspan x={chunk.lens.cx} dy={13}>
                    {formatTokens(chunk.tokens)} tok
                  </tspan>
                ) : null}
              </text>
            </g>
          ) : null,
        )}
        <text
          className="ex-lens__caption ex-lens__caption--lens"
          x={lens.cx}
          y={lens.cy + lens.r + 20}
          textAnchor="middle"
        >
          Sent to the model: {formatTokens(chunks.selectedTokens)} tokens, drawn{' '}
          {chunks.magnification.toFixed(1)}&times; larger
        </text>
      </g>
      <title>{boundary.question}</title>
    </svg>
  );
}

function BoundaryView({ boundary }: { boundary: BoundaryResolution }) {
  const [measuredRef, measured] = useWidth();
  const width = Math.max(MIN_WIDTH, measured ?? 860);
  const layout = useMemo(() => layoutLens(boundary, { width, height: HEIGHT }), [boundary, width]);
  const { decision, record, call, answer } = boundary;
  const path = verdictPath(decision);
  const outcome = outcomeInfo(boundary.outcome);
  const callTarget = useDemoTarget('ai_resolves');
  const selected = layout.chunks.filter((chunk) => chunk.state === 'selected');
  const rejected = layout.chunks.filter((chunk) => chunk.state === 'rejected');
  const findings = {
    clean: layout.chunks.filter((chunk) => chunk.screening === 'clean').length,
    redacted: layout.chunks.filter((chunk) => chunk.screening === 'redacted').length,
    instruction: layout.chunks.filter((chunk) => chunk.screening === 'instruction_like').length,
  };
  const callTokens = call ? call.inputTokens + call.outputTokens : 0;
  const optionLabel = (id: string) =>
    record.options.find((option) => option.id === id)?.label ?? id;

  return (
    <div className="ex-lens__body">
      <p className="ex-lens__question">{boundary.question}</p>
      <p className="ex-lens__reason dim">Why the Reflex stopped to ask: {boundary.reason}</p>

      <div className="ex-lens__hero">
        <div className="ex-lens__stat" data-tone="ash">
          <span className="micro">Observed</span>
          <span className="ex-lens__big num">{formatTokens(layout.observedTokens)}</span>
          <span className="dim">tokens of evidence in {layout.chunks.length} chunks</span>
        </div>
        <ArrowRight className="ex-lens__arrow" size={22} aria-hidden="true" />
        <div className="ex-lens__stat" data-tone="molten">
          <span className="micro">Sent to the model</span>
          <span className="ex-lens__big num">{formatTokens(layout.selectedTokens)}</span>
          <span className="dim">tokens of evidence in {selected.length} chunks</span>
        </div>
        <div className="ex-lens__stat">
          <span className="micro">Withheld</span>
          <span className="ex-lens__big ex-lens__big--sm num">
            {formatPct(withheldRatio(layout), { digits: 1 })}
          </span>
          <span className="dim">{formatTokens(layout.withheldTokens)} tokens stayed local</span>
        </div>
        <div className="ex-lens__hero-prov">
          <Provenance kind="synthetic" metric="context_reduction" />
        </div>
      </div>

      <div
        className="ex-lens__path"
        data-testid="firewall-path"
        role="group"
        aria-label={`Firewall verdict path: ${path.join(', then ')}`}
      >
        <span className="micro">Verdict path</span>
        <ol className="ex-lens__chips">
          {path.map((verdict, index) => (
            <li key={`${verdict}-${index}`}>
              <Chip
                tone={
                  index === path.length - 1
                    ? decision.verdict === 'ALLOW'
                      ? 'molten'
                      : 'crimson'
                    : 'ash'
                }
                variant={index === path.length - 1 ? 'soft' : 'outline'}
                mono
              >
                {verdict}
              </Chip>
              {index < path.length - 1 ? (
                <ChevronRight size={14} aria-hidden="true" className="faint" />
              ) : null}
            </li>
          ))}
        </ol>
        <Chip
          tone={outcome.tone}
          variant="outline"
          icon={
            boundary.outcome === 'resolved' ? (
              <CircleCheck size={12} />
            ) : boundary.outcome === 'denied' ? (
              <Ban size={12} />
            ) : (
              <TriangleAlert size={12} />
            )
          }
        >
          Outcome: {outcome.label}
        </Chip>
      </div>
      <ul className="ex-lens__reasons dim">
        {decision.reasons.map((reason) => (
          <li key={reason}>{reason}</li>
        ))}
      </ul>

      <div className="ex-lens__scroll" ref={measuredRef}>
        <LensPicture boundary={boundary} chunks={layout} />
      </div>

      <div className="ex-lens__split">
        <section className="ex-lens__call" aria-labelledby={`${record.id}-call`} {...callTarget}>
          <h4 id={`${record.id}-call`} className="ex-lens__h">
            The bounded call
          </h4>
          {call ? (
            <>
              <dl className="ex-lens__dl">
                <div>
                  <dt>Model</dt>
                  <dd className="mono">{call.model}</dd>
                </div>
                <div>
                  <dt>Tier</dt>
                  <dd>
                    {decision.tier}{' '}
                    <span className="faint">
                      (budget {formatTokens(decision.budgetTokens)} tokens)
                    </span>
                  </dd>
                </div>
                <div>
                  <dt>Tokens</dt>
                  <dd className="num">
                    {formatTokens(call.inputTokens)} in + {formatTokens(call.outputTokens)} out ={' '}
                    <strong>{formatTokens(callTokens)}</strong>{' '}
                    <Provenance kind={call.tokenProvenance} metric="tokens_per_task" />
                  </dd>
                </div>
                <div>
                  <dt>Latency</dt>
                  <dd className="num">
                    {formatMs(call.latencyMs)}{' '}
                    <Provenance kind={call.latencyProvenance} metric="model_latency" />
                  </dd>
                </div>
                <div>
                  <dt>Provider</dt>
                  <dd>
                    {call.mode === 'deterministic'
                      ? 'Deterministic provider (synthetic): a scripted stand-in, not a real model'
                      : 'Live provider'}
                  </dd>
                </div>
              </dl>
              <details className="ex-lens__details">
                <summary>Show exactly what was sent</summary>
                <pre
                  className="ex-lens__pre mono"
                  tabIndex={0}
                  aria-label="The request sent to the model"
                >
                  {call.requestPreview}
                </pre>
              </details>
            </>
          ) : (
            <p className="dim">No model call was made. {outcome.detail}</p>
          )}
          <h4 className="ex-lens__h">The validated answer</h4>
          {answer ? (
            <div className="ex-lens__answer" data-valid={answer.validated ? 'true' : 'false'}>
              <p className="ex-lens__choice">
                <span className="micro">Chose</span>
                <strong className="mono">{optionLabel(answer.choiceId)}</strong>
                <Chip
                  tone={answer.validated ? 'jade' : 'crimson'}
                  variant="outline"
                  size="sm"
                  icon={answer.validated ? <CircleCheck size={11} /> : <CircleX size={11} />}
                >
                  {answer.validated ? 'validated' : 'not validated'}
                </Chip>
                <span className="faint num">confidence {answer.confidence.toFixed(2)}</span>
              </p>
              <p className="dim">{answer.rationale}</p>
            </div>
          ) : (
            <p className="dim">No answer was accepted. {outcome.detail}</p>
          )}
        </section>

        <section className="ex-lens__questions" aria-labelledby={`${record.id}-q`}>
          <h4 id={`${record.id}-q`} className="ex-lens__h">
            The seven questions, answered before any call
          </h4>
          <ol className="ex-lens__qa">
            {decision.checks.map((check) => (
              <li key={check.id} data-passed={check.passed ? 'true' : 'false'}>
                <span className="ex-lens__qa-icon" aria-hidden="true">
                  {check.passed ? <CircleCheck size={14} /> : <CircleX size={14} />}
                </span>
                <div>
                  <p className="ex-lens__q">
                    {check.question}
                    <span className="sr-only">
                      {check.passed ? ' Answered.' : ' Not answered.'}
                    </span>
                  </p>
                  <p className="ex-lens__a dim">{check.detail}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <div className="ex-lens__ledger">
        <section aria-labelledby={`${record.id}-sel`}>
          <h4 id={`${record.id}-sel`} className="ex-lens__h">
            Selected evidence{' '}
            <span className="faint num">
              {selected.length} chunks, {formatTokens(layout.selectedTokens)} tokens
            </span>
          </h4>
          <ol className="ex-lens__rows">
            {[...selected]
              .sort((a, b) => (a.n ?? 0) - (b.n ?? 0))
              .map((chunk) => (
                <li key={chunk.id}>
                  <span className="ex-lens__num num" aria-label={`Number ${chunk.n ?? ''}`}>
                    {chunk.n}
                  </span>
                  <span className="mono ex-lens__src">{chunk.source}</span>
                  <span className="num ex-lens__tok">{formatTokens(chunk.tokens)} tok</span>
                  <span className="dim ex-lens__why">
                    {chunk.reason} <ScreeningChip chunk={chunk} />
                  </span>
                </li>
              ))}
          </ol>
        </section>
        <section aria-labelledby={`${record.id}-rej`}>
          <h4 id={`${record.id}-rej`} className="ex-lens__h">
            Rejected evidence{' '}
            <span className="faint num">
              {rejected.length} chunks, {formatTokens(layout.withheldTokens)} tokens
            </span>
          </h4>
          <ul className="ex-lens__rows ex-lens__rows--rejected">
            {rejected.map((chunk) => (
              <li key={chunk.id}>
                <span className="ex-lens__num ex-lens__num--no" aria-hidden="true">
                  &times;
                </span>
                <span className="mono ex-lens__src">{chunk.source}</span>
                <span className="num ex-lens__tok">{formatTokens(chunk.tokens)} tok</span>
                <span className="dim ex-lens__why">
                  {chunk.reason} <ScreeningChip chunk={chunk} />
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <p className="ex-lens__screen dim">
        Screening before the call: {findings.clean} clean, {findings.redacted} with a secret
        redacted, {findings.instruction} instruction-like.
      </p>

      <Summary
        description="Every evidence chunk the run had observed, whether the firewall selected it, and why."
        caption="Evidence chunks"
        columns={[
          { id: 'id', header: 'Chunk', cell: (row) => row.id, mono: true },
          { id: 'source', header: 'Source', cell: (row) => row.source, mono: true },
          {
            id: 'tokens',
            header: 'Tokens (synthetic)',
            cell: (row) => formatTokens(row.tokens),
            align: 'end',
            mono: true,
          },
          {
            id: 'state',
            header: 'Decision',
            cell: (row) => (row.state === 'selected' ? 'Selected' : 'Rejected'),
          },
          { id: 'reason', header: 'Reason', cell: (row) => row.reason },
          { id: 'screen', header: 'Screening', cell: (row) => row.screening ?? '\u2014' },
        ]}
        rows={layout.chunks}
        getRowId={(row) => row.id}
      />
    </div>
  );
}

export interface UncertaintyLensProps {
  boundaries: readonly BoundaryResolution[];
}

/** The Token Firewall in one picture: everything observed against the few chunks that may leave. */
export function UncertaintyLens({ boundaries }: UncertaintyLensProps) {
  const [index, setIndex] = useState(0);
  const target = useDemoTarget('firewall');
  const current = boundaries[Math.min(index, boundaries.length - 1)];
  if (!current) return null;
  return (
    <div className={cx('ex-lens')} data-testid="uncertainty-lens" {...target}>
      {boundaries.length > 1 ? (
        <Tabs
          label="Uncertainty boundaries of this run"
          idPrefix="lens-tabs"
          value={String(index)}
          onValueChange={(value) => {
            setIndex(Number(value));
          }}
          items={boundaries.map((boundary, position) => ({
            id: String(position),
            label: boundary.stepId.replace(/_/g, ' '),
          }))}
        />
      ) : null}
      {boundaries.length > 1 ? (
        <TabPanel idPrefix="lens-tabs" id={String(index)} value={String(index)}>
          <BoundaryView key={current.record.id} boundary={current} />
        </TabPanel>
      ) : (
        <BoundaryView key={current.record.id} boundary={current} />
      )}
    </div>
  );
}
