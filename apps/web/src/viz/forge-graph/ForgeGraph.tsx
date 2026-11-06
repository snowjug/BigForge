import type { ReflexStep } from '@bigforge/schemas';
import {
  useDeferredValue,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { prepareDag, topologicalIds } from './dag';
import { fitLayout } from './fit';
import { crackGeometry } from './fracture';
import { KindGlyph, StateGlyph } from './icons';
import {
  KIND_HINT,
  KIND_LABEL,
  METRICS,
  STATE_LABEL,
  TRAVERSED_STATES,
  describeStateChanges,
  formatTokens,
  nodeAccessibleName,
  sameStates,
  shortOperator,
  stateOf,
  stepsFromStructureKey,
  structureKeyOf,
  type GraphMetrics,
} from './model';
import { nextFocusTarget, type NavKey } from './nav';
import { arrowHeadPath, endDirection, roundedPath, shortenEnd } from './path';
import { textWidth, truncateToWidth, wrapText } from './text';
import type { ForgeGraphProps, NodeBadge, NodeState } from './types';
import { useElementWidth } from './useElementWidth';
import type { LayoutNode } from './layout';
import './forge-graph.css';

/** Room around the drawing for rings, glows and the fracture label (tighter in compact panels). */
const PAD = { comfortable: 16, compact: 8 } as const;
const NAV_KEYS: readonly string[] = [
  'ArrowLeft',
  'ArrowRight',
  'ArrowUp',
  'ArrowDown',
  'Home',
  'End',
];
const KIND_ORDER = ['known', 'validation', 'hybrid', 'boundary', 'verification'] as const;

function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

function safeId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9_-]/g, '_');
}

interface GraphNodeProps {
  step: ReflexStep;
  box: LayoutNode;
  metrics: GraphMetrics;
  state: NodeState;
  selected: boolean;
  interactive: boolean;
  tabStop: boolean;
  dim: boolean;
  relation: 'input' | 'output' | null;
  fractureLabel: string | null;
  badge: NodeBadge | undefined;
  showTokens: boolean;
  tokenRatio: number;
  ids: { clip: string; glow: string; beam: string; desc: string };
  register: (id: string, element: SVGGElement | null) => void;
  onActivate: (id: string) => void;
  onFocusNode: (id: string) => void;
  onBlurNode: () => void;
  onHover: (id: string | null) => void;
  onKey: (event: KeyboardEvent<SVGGElement>, id: string) => void;
}

function GraphNode({
  step,
  box,
  metrics: m,
  state,
  selected,
  interactive,
  tabStop,
  dim,
  relation,
  fractureLabel,
  badge,
  showTokens,
  tokenRatio,
  ids,
  register,
  onActivate,
  onFocusNode,
  onBlurNode,
  onHover,
  onKey,
}: GraphNodeProps) {
  const { w, h } = box;
  const r = m.radius;
  const hasFoot = h > m.nodeH;
  const titleLines = wrapText(step.title, w - m.padX - m.iconGutter, m.titleSize, m.titleLines);
  // A single line sits in the middle of the title area instead of hugging the top.
  const titleY = m.titleBaseline + (titleLines.lines.length === 1 ? m.titleLead / 2 : 0);
  const opText = truncateToWidth(
    shortOperator(step.operator.id),
    w - (m.padX + 14) - 8,
    m.opSize,
    true,
  );
  const opY = m.nodeH - m.opBaselineFromBottom;
  const tokens = step.rationale.baselineTokens;
  const caption = badge?.text ?? (showTokens ? `${formatTokens(tokens)} tok` : null);
  const captionTone = badge?.tone ?? (showTokens ? 'ember' : undefined);
  const heat = state === 'running' || state === 'boundary';
  const fractured = fractureLabel !== null;
  const cracked = state === 'stopped' || fractured;
  const crack = cracked ? crackGeometry(step.id, 0, 0, w, m.nodeH) : null;
  const name = nodeAccessibleName(step, state);
  const tooltip = [
    step.title,
    `${step.kind} · ${step.operator.id}`,
    `State: ${STATE_LABEL[state]}`,
    showTokens ? `Baseline tokens replaced: ${formatTokens(tokens)} (synthetic)` : null,
    badge ? badge.text : null,
    fractured ? fractureLabel : null,
  ]
    .filter(Boolean)
    .join('\n');
  const description = [
    KIND_HINT[step.kind],
    showTokens ? `Baseline tokens replaced: ${formatTokens(tokens)} (synthetic).` : null,
    badge ? `Note: ${badge.text}.` : null,
    fractured ? `Fracture: ${fractureLabel}.` : null,
  ]
    .filter(Boolean)
    .join(' ');
  const chipWidth = fractured ? textWidth(fractureLabel, 11) + 24 : 0;

  return (
    <g
      className="bf-node"
      transform={`translate(${box.x} ${box.y})`}
      data-step-id={step.id}
      data-kind={step.kind}
      data-state={state}
      data-selected={selected ? 'true' : undefined}
      data-dim={dim ? 'true' : undefined}
      data-fracture={fractured ? 'true' : undefined}
      data-interactive={interactive ? 'true' : 'false'}
      role="none"
      onPointerEnter={() => {
        onHover(step.id);
      }}
      onPointerLeave={() => {
        onHover(null);
      }}
    >
      {/* Tooltip and description live beside the button, not in it: the button's visible text is
          then only its title, which the accessible name starts with. */}
      <title>{tooltip}</title>
      <desc id={ids.desc}>{description}</desc>
      <g
        className="bf-node__btn"
        data-step-id={step.id}
        role="button"
        tabIndex={tabStop ? 0 : -1}
        aria-label={name}
        aria-pressed={interactive ? selected : undefined}
        aria-describedby={ids.desc}
        ref={(element) => {
          register(step.id, element);
        }}
        onClick={() => {
          onActivate(step.id);
        }}
        onFocus={() => {
          onFocusNode(step.id);
        }}
        onBlur={onBlurNode}
        onKeyDown={(event) => {
          onKey(event, step.id);
        }}
      >
        {/* The aria-label is the node's accessible name. Only the title is text inside the button
            (so the visible label is part of the name); the operator, captions and the fracture
            chip are drawn by the presentational sibling group below. */}
        <g className="bf-node__art" aria-hidden="true">
          <rect className="bf-node__focus" x={-3} y={-3} width={w + 6} height={h + 6} rx={r + 3} />
          {heat ? (
            <rect
              className="bf-node__heat"
              width={w}
              height={h}
              rx={r}
              filter={`url(#${ids.glow})`}
            />
          ) : null}
          {state === 'verified' ? (
            <rect
              className="bf-node__ring"
              x={-3.5}
              y={-3.5}
              width={w + 7}
              height={h + 7}
              rx={r + 3.5}
            />
          ) : null}
          {relation ? (
            <>
              <rect
                className="bf-node__rel"
                data-relation={relation}
                x={-4.5}
                y={-4.5}
                width={w + 9}
                height={h + 9}
                rx={r + 4.5}
              />
              <circle
                className="bf-node__port"
                data-relation={relation}
                cx={relation === 'input' ? w : 0}
                cy={h / 2}
                r={3.2}
              />
            </>
          ) : null}
          {selected ? (
            <path
              className="bf-node__select"
              d={`M-6 2V-6H2M${w - 2} -6H${w + 6}V2M${w + 6} ${h - 2}V${h + 6}H${w - 2}M2 ${h + 6}H-6V${h - 2}`}
            />
          ) : null}
          <rect className="bf-node__body" width={w} height={h} rx={r} />
          {step.kind === 'boundary' ? (
            <>
              <rect
                className="bf-node__beam-glow"
                x={-1.5}
                y={7}
                width={3}
                height={m.nodeH - 14}
                rx={1.5}
                filter={`url(#${ids.beam})`}
              />
              <rect
                className="bf-node__beam"
                x={-1.5}
                y={7}
                width={3}
                height={m.nodeH - 14}
                rx={1.5}
              />
            </>
          ) : null}
          <g clipPath={`url(#${ids.clip})`}>
            {step.kind === 'hybrid' ? <path className="bf-node__notch" d="M0 0H14L0 14Z" /> : null}
            <text className="bf-node__title" x={m.padX} y={titleY} fontSize={m.titleSize}>
              {titleLines.lines.map((line, index) => (
                <tspan key={index} x={m.padX} dy={index === 0 ? 0 : m.titleLead}>
                  {index < titleLines.lines.length - 1 ? `${line} ` : line}
                </tspan>
              ))}
            </text>
          </g>
          <g className="bf-node__kind" transform={`translate(${m.padX + 4} ${opY - 3.6})`}>
            <KindGlyph kind={step.kind} locked={state === 'verified'} />
          </g>
          <g className="bf-node__state" transform={`translate(${w - 14} 16)`}>
            <StateGlyph state={state} />
          </g>
          {crack ? (
            <g className="bf-node__cracks" aria-hidden="true">
              <g className="bf-node__cracks-halo">
                <path d={crack.main} />
                {crack.branches.map((d, index) => (
                  <path key={index} d={d} />
                ))}
              </g>
              <g className="bf-node__cracks-line">
                <path d={crack.main} />
                {crack.branches.map((d, index) => (
                  <path key={index} d={d} />
                ))}
              </g>
            </g>
          ) : null}
        </g>
      </g>
      <g className="bf-node__meta" aria-hidden="true">
        <g clipPath={`url(#${ids.clip})`}>
          <text className="bf-node__op" x={m.padX + 14} y={opY} fontSize={m.opSize}>
            {opText}
          </text>
          {hasFoot ? (
            <g transform={`translate(0 ${m.nodeH})`}>
              <line className="bf-node__rule" x1={m.padX - 2} x2={w - m.padX + 2} y1={0} y2={0} />
              {caption ? (
                <text className="bf-node__cap" x={m.padX} y={14} data-tone={captionTone}>
                  {truncateToWidth(caption, w - m.padX * 2, 11, true)}
                </text>
              ) : null}
              {showTokens ? (
                <g>
                  <rect
                    className="bf-node__bar-track"
                    x={m.padX}
                    y={18}
                    width={w - m.padX * 2}
                    height={3}
                    rx={1.5}
                  />
                  {tokens > 0 ? (
                    <rect
                      className="bf-node__bar"
                      x={m.padX}
                      y={18}
                      width={Math.max(3, (w - m.padX * 2) * tokenRatio)}
                      height={3}
                      rx={1.5}
                    />
                  ) : null}
                </g>
              ) : null}
            </g>
          ) : null}
        </g>
        {fractured ? (
          <g className="bf-node__chip" transform={`translate(${(w - chipWidth) / 2} ${h + 7})`}>
            <rect width={chipWidth} height={20} rx={10} />
            <path className="bf-node__chip-mark" d="M10 5.5L7.4 10.2H11L8.6 14.8" />
            <text x={17} y={14.2}>
              {fractureLabel}
            </text>
          </g>
        ) : null}
      </g>
    </g>
  );
}

/**
 * Forge Graph: the SVG DAG of a Reflex's steps. Layered layout from `dependsOn`, node colour and
 * shape by `kind`, runtime state overlay, optional drift fracture, keyboard navigation and an
 * equivalent text summary.
 */
export function ForgeGraph({
  steps,
  states,
  selectedId = null,
  onSelect,
  fracture = null,
  badges,
  showTokens = false,
  direction = 'LR',
  density = 'comfortable',
  ariaLabel,
  className,
}: ForgeGraphProps): ReactElement {
  const uid = safeId(useId());
  const m = METRICS[density];
  const pad = PAD[density];
  const [scrollRef, measured] = useElementWidth();
  // The first measurement applies at once (no frame of the unfolded layout); later resizes are
  // deferred so dragging a panel edge never blocks input.
  const deferred = useDeferredValue(measured);
  const available = deferred ?? measured;
  const fitWidth = available === null ? null : Math.floor(available / 4) * 4;

  const structureKey = useMemo(() => structureKeyOf(steps), [steps]);
  const structure = useMemo(() => stepsFromStructureKey(structureKey), [structureKey]);
  const dag = useMemo(() => prepareDag(structure), [structure]);

  const hasFoot = showTokens || (badges !== undefined && Object.keys(badges).length > 0);
  const hasFracture = fracture !== null;
  const nodeH = m.nodeH + (hasFoot ? m.footH : 0);
  const crossGap = m.gapCross + (hasFracture ? 14 : 0);
  const layout = useMemo(
    () =>
      fitLayout(
        structure,
        {
          direction,
          nodeW: m.nodeW,
          nodeH,
          gapX: direction === 'LR' ? m.gapFlow : crossGap,
          gapY: direction === 'LR' ? crossGap : m.gapFlow,
        },
        fitWidth,
        pad,
      ),
    [structure, direction, m.nodeW, nodeH, m.gapFlow, crossGap, fitWidth, pad],
  );

  const stepById = useMemo(() => new Map(steps.map((step) => [step.id, step])), [steps]);
  const titles = useMemo(
    () => new Map(steps.map((step) => [step.id, step.title] as const)),
    [steps],
  );
  const maxTokens = useMemo(
    () => steps.reduce((max, step) => Math.max(max, step.rationale.baselineTokens), 0),
    [steps],
  );
  const order = useMemo(() => topologicalIds(layout.layers), [layout.layers]);
  const indexOf = useMemo(() => new Map(dag.ids.map((id, i) => [id, i] as const)), [dag.ids]);

  const downstream = useMemo(() => {
    const out = new Set<string>();
    const start = fracture ? indexOf.get(fracture.stepId) : undefined;
    if (start === undefined) return out;
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop() as number;
      for (const next of dag.succs[node] ?? []) {
        const id = dag.ids[next] as string;
        if (out.has(id)) continue;
        out.add(id);
        stack.push(next);
      }
    }
    return out;
  }, [fracture, indexOf, dag]);

  // ---- announcements: only when `states` really changed ----
  const [seenStates, setSeenStates] = useState(states);
  const [announcement, setAnnouncement] = useState({ text: '', count: 0 });
  if (!sameStates(seenStates, states, dag.ids)) {
    setSeenStates(states);
    const text = describeStateChanges(seenStates, states, dag.ids, titles);
    if (text) setAnnouncement((prev) => ({ text, count: prev.count + 1 }));
  }

  // ---- roving tab stop and keyboard ----
  const nodeRefs = useRef(new Map<string, SVGGElement>());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const known = (id: string | null): id is string => id !== null && stepById.has(id);
  const tabStopId = known(activeId)
    ? activeId
    : known(selectedId)
      ? selectedId
      : (order[0] ?? null);
  /** The step whose edges are emphasised and whose implied inputs are revealed. */
  const spotlight = known(hoverId)
    ? hoverId
    : known(focusId)
      ? focusId
      : known(selectedId)
        ? selectedId
        : null;

  const register = (id: string, element: SVGGElement | null): void => {
    if (element) nodeRefs.current.set(id, element);
    else nodeRefs.current.delete(id);
  };
  const handleKey = (event: KeyboardEvent<SVGGElement>, id: string): void => {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect?.(id);
      return;
    }
    if (!NAV_KEYS.includes(event.key)) return;
    const target = nextFocusTarget({
      nodes: layout.nodes,
      // implied edges are not drawn, so they do not count as connections either
      edges: layout.edges.filter((edge) => edge.implied !== true),
      order,
      current: id,
      key: event.key as NavKey,
      direction,
    });
    if (target) {
      event.preventDefault();
      nodeRefs.current.get(target)?.focus();
    }
  };

  const interactive = onSelect !== undefined;
  const width = layout.width + pad * 2;
  const height = layout.height + pad * 2;
  const clipId = `${uid}-clip`;
  const glowId = `${uid}-glow`;
  const beamId = `${uid}-beam`;

  // Implied (transitive) edges are not drawn: the backbone carries the structure. The steps they
  // connect to the spotlight are marked instead, so no dependency stays hidden.
  const relation = new Map<string, 'input' | 'output'>();
  if (spotlight !== null) {
    for (const edge of layout.edges) {
      if (!edge.implied) continue;
      if (edge.to === spotlight) relation.set(edge.from, 'input');
      else if (edge.from === spotlight) relation.set(edge.to, 'output');
    }
  }

  const edgeViews = layout.edges
    .filter((edge) => edge.implied !== true)
    .map((edge) => {
      const from = stateOf(states, edge.from);
      const to = stateOf(states, edge.to);
      const faded =
        fracture !== null && (edge.from === fracture.stepId || downstream.has(edge.from));
      return {
        edge,
        traversed: TRAVERSED_STATES.has(from) && TRAVERSED_STATES.has(to),
        faded,
        related: spotlight !== null && (edge.from === spotlight || edge.to === spotlight),
      };
    })
    .sort(
      (a, b) => Number(a.related) - Number(b.related) || Number(a.traversed) - Number(b.traversed),
    );

  const nodeBoxes = [...layout.nodes].sort(
    (a, b) =>
      Number(a.id === fracture?.stepId) - Number(b.id === fracture?.stepId) ||
      Number(a.id === selectedId) - Number(b.id === selectedId),
  );

  return (
    <div
      className={cx('bf-fg', className)}
      role="group"
      aria-label={ariaLabel}
      data-direction={direction}
      data-density={density}
    >
      <div className="bf-fg__scroll" ref={scrollRef}>
        <svg
          className="bf-fg__svg"
          width={width}
          height={height}
          viewBox={`${-pad} ${-pad} ${width} ${height}`}
          focusable="false"
        >
          <defs>
            <filter id={glowId} x="-30%" y="-50%" width="160%" height="200%">
              <feGaussianBlur stdDeviation="5" />
            </filter>
            <filter id={beamId} x="-400%" y="-30%" width="900%" height="160%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <clipPath id={clipId}>
              <rect width={m.nodeW} height={nodeH} rx={m.radius} />
            </clipPath>
          </defs>
          <g transform="translate(0.5 0.5)">
            <g className="bf-fg__edges" aria-hidden="true">
              {edgeViews.map(({ edge, traversed, faded, related }) => {
                const tip = edge.points[edge.points.length - 1];
                if (!tip) return null;
                const dir = endDirection(edge.points);
                return (
                  <g
                    key={`${edge.from}>${edge.to}`}
                    className="bf-edge"
                    data-traversed={traversed ? 'true' : undefined}
                    data-faded={faded ? 'true' : undefined}
                    data-related={related ? 'true' : undefined}
                  >
                    <path
                      className="bf-edge__line"
                      d={roundedPath(shortenEnd(edge.points, 6), 9)}
                    />
                    <path className="bf-edge__head" d={arrowHeadPath(tip, dir)} />
                  </g>
                );
              })}
            </g>
            <g className="bf-fg__nodes">
              {nodeBoxes.map((box) => {
                const step = stepById.get(box.id);
                if (!step) return null;
                const tokens = step.rationale.baselineTokens;
                return (
                  <GraphNode
                    key={box.id}
                    step={step}
                    box={box}
                    metrics={m}
                    state={stateOf(states, box.id)}
                    selected={selectedId === box.id}
                    interactive={interactive}
                    tabStop={tabStopId === box.id}
                    dim={downstream.has(box.id)}
                    relation={relation.get(box.id) ?? null}
                    fractureLabel={
                      fracture?.stepId === box.id ? (fracture.label ?? 'diverges here') : null
                    }
                    badge={badges?.[box.id]}
                    showTokens={showTokens}
                    tokenRatio={maxTokens > 0 ? tokens / maxTokens : 0}
                    ids={{
                      clip: clipId,
                      glow: glowId,
                      beam: beamId,
                      desc: `${uid}-desc-${box.id}`,
                    }}
                    register={register}
                    onActivate={(id) => {
                      onSelect?.(id);
                    }}
                    onFocusNode={(id) => {
                      setActiveId(id);
                      setFocusId(id);
                    }}
                    onBlurNode={() => {
                      setFocusId(null);
                    }}
                    onHover={setHoverId}
                    onKey={handleKey}
                  />
                );
              })}
            </g>
          </g>
        </svg>
      </div>

      {showTokens ? (
        <p className="bf-fg__note">
          Token bars: mean baseline tokens each step replaces. <strong>Synthetic</strong>, not
          measured.
        </p>
      ) : null}
      {density === 'comfortable' ? (
        <ul className="bf-fg__legend" aria-hidden="true">
          {KIND_ORDER.map((kind) => (
            <li key={kind}>
              <svg width={16} height={16} viewBox="-8 -8 16 16" data-kind={kind} focusable="false">
                <KindGlyph kind={kind} />
              </svg>
              <span>{KIND_LABEL[kind]}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <details className="bf-fg__summary">
        <summary>Text summary of this graph</summary>
        {fracture && stepById.has(fracture.stepId) ? (
          <p>
            Fracture: {fracture.label ?? 'diverges here'} at step {titles.get(fracture.stepId)}.
            Steps downstream of it are dimmed.
          </p>
        ) : null}
        <ol>
          {order.map((id) => {
            const step = stepById.get(id);
            if (!step) return null;
            const deps = (dag.preds[indexOf.get(id) ?? 0] ?? []).map(
              (dep) => titles.get(dag.ids[dep] as string) ?? (dag.ids[dep] as string),
            );
            return (
              <li key={id}>
                <strong>{step.title}</strong>: {step.kind} step, operator {step.operator.id}.{' '}
                {deps.length > 0 ? `Depends on ${deps.join(', ')}.` : 'No dependencies.'} State:{' '}
                {STATE_LABEL[stateOf(states, id)]}.
                {showTokens
                  ? ` Baseline tokens replaced (synthetic): ${formatTokens(step.rationale.baselineTokens)}.`
                  : ''}
                {badges?.[id] ? ` ${badges[id].text}.` : ''}
              </li>
            );
          })}
        </ol>
      </details>

      <div className="bf-fg__live" aria-live="polite" aria-atomic="true">
        <span key={announcement.count}>{announcement.text}</span>
      </div>
    </div>
  );
}
