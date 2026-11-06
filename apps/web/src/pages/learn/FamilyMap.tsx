import type { FamiliesViewDto } from '@bigforge/schemas';
import { type KeyboardEvent, useMemo, useRef, useState } from 'react';
import { truncateLabel } from '../../viz/dna/dnaModel';
import { useMeasuredWidth } from '../../viz/dna/useMeasuredWidth';
import { Summary, formatPct } from '../../ui';
import {
  type MapNode,
  NODE_RADIUS,
  UNMATCHED_ID,
  compareScenarioIds,
  layoutFamilyMap,
  strongestNeighbours,
} from './clusterLayout';
import { type ScenarioRole, nodeRoleLabel } from './familyView';

interface FamilyMapProps {
  view: FamiliesViewDto;
  selectedFamilyId: string | null;
  selectedTaskId: string | null;
  onSelectFamily: (familyId: string) => void;
  onSelectTask: (node: MapNode | null) => void;
  roles: ReadonlyMap<string, ScenarioRole>;
}

type NodeKind = 'learned' | 'matched' | 'unmatched' | 'noise';

function kindOf(node: MapNode): NodeKind {
  if (node.origin === 'noise') return 'noise';
  if (node.clusterId === UNMATCHED_ID) return 'unmatched';
  return node.learned ? 'learned' : 'matched';
}

const KIND_TEXT: Record<NodeKind, string> = {
  learned: 'a source of the Reflex',
  matched: 'matched to the family since',
  unmatched: 'not in a family',
  noise: 'unrelated to the family',
};

function describeNode(node: MapNode): string {
  const parts = [
    `${node.scenarioId}: ${node.title}`,
    `${KIND_TEXT[kindOf(node)]}`,
    `intent ${node.intent.replaceAll('_', ' ')}`,
    `failure ${node.failureType}`,
    `toolchain ${node.toolchain ?? 'unknown'}`,
  ];
  return parts.join('. ');
}

/**
 * The families map: tasks grouped by family on a deterministic layout, unmatched tasks apart. Nodes are
 * buttons (arrow keys move between them); the backbone shows the strongest similarity links and a selected
 * task reveals its own nearest neighbours. A table below carries the same information.
 */
export function FamilyMap({
  view,
  selectedFamilyId,
  selectedTaskId,
  onSelectFamily,
  onSelectTask,
  roles,
}: FamilyMapProps) {
  const [scrollRef, measured] = useMeasuredWidth();
  const layout = useMemo(() => layoutFamilyMap(view, { width: measured ?? 720 }), [view, measured]);
  const byId = useMemo(() => new Map(layout.nodes.map((n) => [n.taskId, n])), [layout]);
  const refs = useRef(new Map<string, SVGGElement>());
  const [activeId, setActiveId] = useState<string | null>(null);

  const neighbours = useMemo(
    () => (selectedTaskId ? strongestNeighbours(view.edges, selectedTaskId, 4) : []),
    [view.edges, selectedTaskId],
  );
  const neighbourScore = new Map(neighbours.map((n) => [n.taskId, n.score]));
  const selectedNode = selectedTaskId ? byId.get(selectedTaskId) : undefined;
  const order = layout.nodes.map((n) => n.taskId);
  const tabStop =
    activeId !== null && byId.has(activeId)
      ? activeId
      : selectedTaskId !== null && byId.has(selectedTaskId)
        ? selectedTaskId
        : (order[0] ?? null);

  const onKeyDown = (event: KeyboardEvent<SVGGElement>, node: MapNode) => {
    const index = order.indexOf(node.taskId);
    let next: number;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
      next = Math.min(order.length - 1, index + 1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') next = Math.max(0, index - 1);
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = order.length - 1;
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelectTask(selectedTaskId === node.taskId ? null : node);
      return;
    } else if (event.key === 'Escape') {
      onSelectTask(null);
      return;
    } else return;
    event.preventDefault();
    const target = order[next];
    if (target !== undefined) refs.current.get(target)?.focus();
  };

  const rows = useMemo(
    () => [...layout.nodes].sort((a, b) => compareScenarioIds(a.scenarioId, b.scenarioId)),
    [layout.nodes],
  );
  const families = new Map(view.families.map((f) => [f.id, f]));
  const width = Math.max(layout.width, measured ?? 0);
  const height = Math.max(layout.height, 300);
  const dx = (width - layout.width) / 2;

  return (
    <div className="learn-map" data-testid="family-map">
      <div className="learn-map__scroll" ref={scrollRef}>
        <svg
          className="learn-map__svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="group"
          aria-label={`Map of ${view.nodes.length} tasks in ${view.families.length === 1 ? '1 family' : `${view.families.length} families`}${view.nodes.some((n) => n.familyId === null) ? ' and an unmatched group' : ''}. Use the table below for the same information.`}
          focusable="false"
        >
          <g transform={`translate(${dx} 0)`}>
            {layout.clusters.map((cluster) => {
              if (cluster.kind === 'unmatched') {
                return (
                  <g key={cluster.id} className="learn-zone">
                    <rect
                      className="learn-zone__box"
                      x={cluster.x}
                      y={cluster.y + 28}
                      width={cluster.width}
                      height={cluster.height - 28}
                      rx={10}
                    />
                    <text className="learn-zone__label" x={cluster.x + 2} y={cluster.y + 14}>
                      {`${cluster.label} \u00b7 ${cluster.nodeIds.length}`}
                    </text>
                  </g>
                );
              }
              const family = families.get(cluster.id);
              const selected = cluster.id === selectedFamilyId;
              return (
                <g
                  key={cluster.id}
                  className="learn-disc"
                  data-selected={selected ? 'true' : undefined}
                >
                  <circle
                    className="learn-disc__ring"
                    cx={cluster.cx}
                    cy={cluster.cy}
                    r={cluster.radius}
                  />
                  <circle
                    className="learn-disc__core"
                    cx={cluster.cx}
                    cy={cluster.cy}
                    r={3}
                    aria-hidden="true"
                  />
                  <g
                    className="learn-disc__label"
                    role="button"
                    tabIndex={0}
                    aria-pressed={selected}
                    aria-label={`Family ${family?.name ?? cluster.label}: ${cluster.nodeIds.length} tasks, ${cluster.variantCount} variants`}
                    onClick={() => {
                      onSelectTask(null);
                      onSelectFamily(cluster.id);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        onSelectTask(null);
                        onSelectFamily(cluster.id);
                      }
                    }}
                  >
                    <rect
                      className="learn-disc__hit"
                      x={cluster.cx - cluster.radius}
                      y={cluster.y}
                      width={cluster.radius * 2}
                      height={26}
                      rx={6}
                    />
                    <text
                      className="learn-disc__name"
                      x={cluster.cx}
                      y={cluster.y + 17}
                      textAnchor="middle"
                    >
                      {truncateLabel(
                        family?.name ?? cluster.label,
                        Math.max(12, Math.floor((cluster.radius * 2) / 7)),
                      )}
                    </text>
                  </g>
                </g>
              );
            })}

            <g aria-hidden="true">
              {layout.backbone.map((edge) => {
                const a = byId.get(edge.a);
                const b = byId.get(edge.b);
                if (!a || !b) return null;
                return (
                  <line
                    key={`${edge.a}|${edge.b}`}
                    className="learn-link"
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    strokeOpacity={0.15 + Math.max(0, edge.score - 0.5) * 0.7}
                  />
                );
              })}
              {selectedNode
                ? neighbours.map((n) => {
                    const other = byId.get(n.taskId);
                    if (!other) return null;
                    return (
                      <line
                        key={`sel-${n.taskId}`}
                        className="learn-link learn-link--selected"
                        x1={selectedNode.x}
                        y1={selectedNode.y}
                        x2={other.x}
                        y2={other.y}
                        strokeWidth={0.8 + (n.score - 0.5) * 3.5}
                      />
                    );
                  })
                : null}
            </g>

            {layout.nodes.map((node) => {
              const kind = kindOf(node);
              const selected = node.taskId === selectedTaskId;
              const score = neighbourScore.get(node.taskId);
              return (
                <g
                  key={node.taskId}
                  className="learn-node"
                  role="button"
                  tabIndex={tabStop === node.taskId ? 0 : -1}
                  aria-pressed={selected}
                  aria-label={describeNode(node)}
                  data-kind={kind}
                  data-selected={selected ? 'true' : undefined}
                  data-neighbour={score !== undefined ? 'true' : undefined}
                  style={{ transform: `translate(${node.x}px, ${node.y}px)` }}
                  ref={(element) => {
                    if (element) refs.current.set(node.taskId, element);
                    else refs.current.delete(node.taskId);
                  }}
                  onClick={() => {
                    onSelectTask(selected ? null : node);
                  }}
                  onFocus={() => {
                    setActiveId(node.taskId);
                  }}
                  onKeyDown={(event) => {
                    onKeyDown(event, node);
                  }}
                >
                  <title>{describeNode(node)}</title>
                  <circle className="learn-node__focus" r={NODE_RADIUS + 5} />
                  <circle className="learn-node__body" r={NODE_RADIUS} />
                  <text className="learn-node__label" y={4}>
                    {node.scenarioId}
                  </text>
                  {score !== undefined ? (
                    <text className="learn-node__score" y={NODE_RADIUS + 14} aria-hidden="true">
                      {score.toFixed(2)}
                    </text>
                  ) : kind === 'noise' || kind === 'unmatched' ? (
                    <text className="learn-node__sub" y={NODE_RADIUS + 14} aria-hidden="true">
                      {node.failureType}
                    </text>
                  ) : null}
                </g>
              );
            })}
          </g>
        </svg>
      </div>

      <div className="learn-map__legend" aria-label="Map legend">
        <span className="learn-legend__item">
          <svg
            width="22"
            height="22"
            viewBox="-11 -11 22 22"
            aria-hidden="true"
            data-kind="learned"
            className="learn-node"
          >
            <circle className="learn-node__body" r="9" />
          </svg>
          Learned from (a source trace)
        </span>
        <span className="learn-legend__item">
          <svg
            width="22"
            height="22"
            viewBox="-11 -11 22 22"
            aria-hidden="true"
            data-kind="matched"
            className="learn-node"
          >
            <circle className="learn-node__body" r="9" />
          </svg>
          Matched since
        </span>
        <span className="learn-legend__item">
          <svg
            width="22"
            height="22"
            viewBox="-11 -11 22 22"
            aria-hidden="true"
            data-kind="noise"
            className="learn-node"
          >
            <circle className="learn-node__body" r="9" />
          </svg>
          Not in a family
        </span>
        <span className="learn-legend__note">
          Closer to the centre means more typical of the family. Lines are the strongest similarity
          links (stronger = more similar). Arrow keys move between tasks.
        </span>
      </div>

      <Summary
        label="View the map as a table"
        description="Every task the forge has seen, the group it landed in, and the fingerprint features that decided it."
        caption="Tasks and their families"
        rows={rows}
        getRowId={(node) => node.taskId}
        columns={[
          { id: 'task', header: 'Task', mono: true, cell: (n) => n.scenarioId },
          { id: 'title', header: 'Title', cell: (n) => n.title },
          {
            id: 'group',
            header: 'Group',
            cell: (n) =>
              n.familyId ? (families.get(n.familyId)?.name ?? n.familyId) : 'Not in a family',
          },
          { id: 'role', header: 'Role', cell: (n) => nodeRoleLabel(n, roles) },
          { id: 'variant', header: 'Variant', mono: true, cell: (n) => n.variantKey },
          { id: 'intent', header: 'Intent', cell: (n) => n.intent.replaceAll('_', ' ') },
          { id: 'failure', header: 'Failure', cell: (n) => n.failureType },
          { id: 'tool', header: 'Toolchain', cell: (n) => n.toolchain ?? 'unknown' },
          {
            id: 'affinity',
            header: 'Similarity to family',
            align: 'end',
            mono: true,
            cell: (n) => (n.affinity === null ? '\u2014' : formatPct(n.affinity, { digits: 1 })),
          },
        ]}
      />
    </div>
  );
}
