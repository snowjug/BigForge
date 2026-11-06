import type {
  FamilyDto,
  FamilyMatch,
  FamiliesViewDto,
  ReflexVersionSummaryDto,
} from '@bigforge/schemas';
import { ArrowLeft, CircleCheck, CircleX, ExternalLink } from 'lucide-react';
import { type CSSProperties, useMemo } from 'react';
import { Link } from 'react-router';
import { reflexPath, runPath } from '../../routes';
import {
  Button,
  ButtonLink,
  Chip,
  ErrorState,
  Meter,
  Provenance,
  SkeletonGroup,
  SkeletonLines,
  StatusChip,
  Summary,
  formatPct,
  plural,
  relativeTime,
} from '../../ui';
import { useNow } from '../../hooks/useNow';
import { ReflexGlyph } from '../../viz';
import { type MapNode, UNMATCHED_ID, strongestNeighbours } from './clusterLayout';
import {
  type ScenarioRole,
  centroidRows,
  groupFaults,
  groupVariants,
  nodeRoleLabel,
} from './familyView';
import { useWhyMatched } from './hooks';

interface InspectorProps {
  view: FamiliesViewDto;
  family: FamilyDto | null;
  node: MapNode | null;
  nodesById: ReadonlyMap<string, MapNode>;
  roles: ReadonlyMap<string, ScenarioRole>;
  versions: readonly ReflexVersionSummaryDto[];
  onSelectTask: (taskId: string | null) => void;
}

function Gates({ match }: { match: FamilyMatch }) {
  if (match.hardGates.length === 0) return null;
  return (
    <ul className="learn-gates" aria-label="Hard gates">
      {match.hardGates.map((gate) => (
        <li key={gate.id} data-passed={gate.passed}>
          {gate.passed ? (
            <CircleCheck size={15} aria-hidden="true" />
          ) : (
            <CircleX size={15} aria-hidden="true" />
          )}
          <span>
            <strong>{gate.id.replaceAll('_', ' ')}</strong>
            <span className="sr-only">{gate.passed ? ' passed. ' : ' failed. '}</span>
            <span className="dim"> {gate.detail}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

function WhyMatched({ taskId }: { taskId: string }) {
  const why = useWhyMatched(taskId);
  if (why.isPending) {
    return (
      <SkeletonGroup label="Scoring the task against the family">
        <SkeletonLines lines={4} />
      </SkeletonGroup>
    );
  }
  if (why.isError) {
    return (
      <ErrorState
        compact
        title="Could not score this task"
        error={why.error}
        onRetry={() => {
          void why.refetch();
        }}
      />
    );
  }
  const { match } = why.data;
  const tone =
    match.decision === 'match' ? 'jade' : match.decision === 'ambiguous' ? 'amber' : 'ash';
  return (
    <div className="stack" style={{ '--gap': '12px' } as CSSProperties}>
      <div className="cluster">
        <Chip
          tone={tone}
          variant="outline"
          dashed={match.decision !== 'match'}
          icon={match.decision === 'match' ? <CircleCheck size={12} /> : <CircleX size={12} />}
        >
          {match.decision === 'match'
            ? `Matches ${match.familyName ?? 'the family'}`
            : match.decision === 'ambiguous'
              ? 'Ambiguous'
              : 'No match'}
        </Chip>
        <Provenance kind="synthetic" />
      </div>
      {match.hardGates.length > 0 || match.features.length > 0 ? (
        <div>
          <Meter
            value={match.score}
            label="Similarity to the family centroid"
            valueText={match.score.toFixed(3)}
            threshold={match.threshold}
            thresholdLabel={`Match threshold ${match.threshold}`}
            tone={match.decision === 'match' ? 'jade' : 'ash'}
            showValue
          />
          <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 4 }}>
            Similarity {match.score.toFixed(3)} against a match threshold of {match.threshold}. A
            task matches only when every hard gate passes and the weighted score reaches the
            threshold.
          </p>
        </div>
      ) : null}
      <Gates match={match} />
      {match.features.length > 0 ? (
        <Summary
          label="Weighted features"
          defaultOpen
          description="How each fingerprint feature scored, its weight in the matcher, and what it contributed."
          caption="Weighted matcher features"
          rows={match.features}
          getRowId={(f) => f.name}
          columns={[
            { id: 'name', header: 'Feature', cell: (f) => f.name.replaceAll('_', ' ') },
            {
              id: 'score',
              header: 'Score',
              align: 'end',
              mono: true,
              cell: (f) => f.score.toFixed(2),
            },
            {
              id: 'weight',
              header: 'Weight',
              align: 'end',
              mono: true,
              cell: (f) => f.weight.toFixed(2),
            },
            {
              id: 'contrib',
              header: 'Adds',
              align: 'end',
              mono: true,
              cell: (f) => (f.score * f.weight).toFixed(3),
            },
          ]}
        />
      ) : null}
      {match.reasons.length > 0 ? (
        <ul className="learn-reasons">
          {match.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function TaskView({
  node,
  view,
  nodesById,
  roles,
  onSelectTask,
}: Pick<InspectorProps, 'node' | 'view' | 'nodesById' | 'roles' | 'onSelectTask'> & {
  node: MapNode;
}) {
  const neighbours = useMemo(
    () => strongestNeighbours(view.edges, node.taskId, 5),
    [view.edges, node.taskId],
  );
  const inFamily = node.clusterId !== UNMATCHED_ID;
  return (
    <div className="learn-ins" data-testid="task-inspector">
      <Button
        size="sm"
        variant="ghost"
        icon={<ArrowLeft size={14} />}
        onClick={() => {
          onSelectTask(null);
        }}
      >
        Back to the family
      </Button>
      <div>
        <p className="micro">Task</p>
        <h3 className="learn-ins__title">
          <span className="mono">{node.scenarioId}</span> {node.title}
        </h3>
      </div>
      <div className="cluster">
        <Chip tone="neutral" variant="outline">
          {nodeRoleLabel(node, roles)}
        </Chip>
        {inFamily ? (
          <Chip tone={node.learned ? 'steel' : 'jade'} variant="outline" dashed={!node.learned}>
            {node.learned ? 'Source of the Reflex' : 'Matched since'}
          </Chip>
        ) : (
          <Chip tone="ash" variant="outline" dashed>
            Not in a family
          </Chip>
        )}
      </div>
      <dl className="learn-facts">
        <dt>Variant</dt>
        <dd className="mono">{node.variantKey}</dd>
        <dt>Intent</dt>
        <dd>{node.intent.replaceAll('_', ' ')}</dd>
        <dt>Failure type</dt>
        <dd>{node.failureType}</dd>
        <dt>Toolchain</dt>
        <dd>{node.toolchain ?? 'unknown'}</dd>
        {node.affinity !== null ? (
          <>
            <dt>Similarity</dt>
            <dd>
              <span className="mono num">{formatPct(node.affinity, { digits: 1 })}</span> mean
              similarity to the rest of its family
            </dd>
          </>
        ) : null}
      </dl>
      <section aria-label="Why it matched">
        <h4 className="learn-ins__sub">{inFamily ? 'Why it matched' : 'Why it did not match'}</h4>
        <WhyMatched taskId={node.taskId} />
      </section>
      {neighbours.length > 0 ? (
        <section aria-label="Most similar tasks">
          <h4 className="learn-ins__sub">Most similar tasks</h4>
          <ul className="learn-neighbours">
            {neighbours.map((n) => {
              const other = nodesById.get(n.taskId);
              return (
                <li key={n.taskId}>
                  <button
                    type="button"
                    className="learn-neighbour"
                    onClick={() => {
                      if (other) onSelectTask(other.taskId);
                    }}
                  >
                    <span className="mono">{other?.scenarioId ?? n.taskId}</span>
                    <span className="dim truncate">{other?.title ?? ''}</span>
                    <span className="mono num">{n.score.toFixed(3)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      <ButtonLink
        to={runPath({ task: node.taskId })}
        size="sm"
        iconRight={<ExternalLink size={13} />}
      >
        Open in the Run Console
      </ButtonLink>
    </div>
  );
}

function FamilyView({
  family,
  view,
  versions,
}: Pick<InspectorProps, 'view' | 'versions'> & { family: FamilyDto }) {
  const now = useNow();
  const firstMember = family.members[0]?.taskId ?? null;
  const why = useWhyMatched(firstMember);
  const weights = new Map<string, number>(
    (why.data?.match.features ?? []).map((f) => [f.name, f.weight]),
  );
  const rows = centroidRows(family.centroid);
  const members = view.nodes.filter((n) => n.familyId === family.id);
  const learned = new Set(family.members.map((m) => m.taskId));
  const since = members.filter((n) => !learned.has(n.taskId));
  const variants = groupVariants(members);
  const faults = groupFaults(members);
  const { thresholds } = view;
  const enoughTasks = family.members.length >= thresholds.minMembers;
  const enoughVariants = family.variants.length >= thresholds.minVariants;

  return (
    <div className="learn-ins" data-testid="family-inspector">
      <div>
        <p className="micro">Task family</p>
        <h3 className="learn-ins__title">{family.name}</h3>
        <p className="mono faint" style={{ fontSize: 'var(--fs-xs)' }}>
          {family.id} · found {relativeTime(family.createdAt, now)}
        </p>
      </div>
      <p className="dim" style={{ fontSize: 'var(--fs-sm)' }}>
        {family.description}
      </p>
      <ul className="learn-rules" aria-label="Discovery thresholds">
        <li data-ok={enoughTasks}>
          {enoughTasks ? (
            <CircleCheck size={15} aria-hidden="true" />
          ) : (
            <CircleX size={15} aria-hidden="true" />
          )}
          <span>
            <strong className="num">{family.members.length}</strong> tasks learned from (at least{' '}
            {thresholds.minMembers} needed)
          </span>
        </li>
        <li data-ok={enoughVariants}>
          {enoughVariants ? (
            <CircleCheck size={15} aria-hidden="true" />
          ) : (
            <CircleX size={15} aria-hidden="true" />
          )}
          <span>
            <strong className="num">{family.variants.length}</strong> distinct variants (at least{' '}
            {thresholds.minVariants} needed)
          </span>
        </li>
        <li data-ok="true">
          <CircleCheck size={15} aria-hidden="true" />
          <span>
            Clustered at similarity <strong className="num">{thresholds.cluster}</strong> or more; a
            new task matches at <strong className="num">{thresholds.match}</strong>
          </span>
        </li>
      </ul>
      {since.length > 0 ? (
        <p className="dim" style={{ fontSize: 'var(--fs-sm)' }}>
          {plural(since.length, 'task')} matched this family after discovery (shadow and held-out
          tasks).
        </p>
      ) : null}

      <section aria-label="Variants">
        <h4 className="learn-ins__sub">
          Variants{' '}
          <span className="faint">
            ({variants.length} across {faults.length} fault kinds)
          </span>
        </h4>
        <ul className="learn-variants">
          {faults.map((f) => (
            <li key={f.fault}>
              <span className="mono">{f.fault}</span>
              <span className="faint mono num"> ×{f.tasks}</span>
              {f.workspaces.length > 0 ? (
                <span className="faint"> in {f.workspaces.join(', ')}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Centroid fingerprint">
        <h4 className="learn-ins__sub">Centroid fingerprint and weights</h4>
        <div
          className="learn-table-wrap"
          tabIndex={0}
          role="region"
          aria-label="Centroid fingerprint features and weights"
        >
          <table className="learn-table">
            <thead>
              <tr>
                <th scope="col">Feature</th>
                <th scope="col">Centroid</th>
                <th scope="col" className="learn-table__end">
                  Weight
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.feature}>
                  <th scope="row">{row.label}</th>
                  <td>{row.value}</td>
                  <td className="learn-table__end mono num">
                    {weights.has(row.feature)
                      ? (weights.get(row.feature) as number).toFixed(2)
                      : '\u2014'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="faint" style={{ fontSize: 'var(--fs-xs)', marginTop: 6 }}>
          A task matches when every hard gate passes and the weighted score reaches the threshold.
          Computed on the synthetic lab <Provenance kind="synthetic" />
        </p>
      </section>

      <section aria-label="Reflexes compiled from this family">
        <h4 className="learn-ins__sub">Reflexes from this family</h4>
        {versions.length === 0 ? (
          <p className="dim" style={{ fontSize: 'var(--fs-sm)' }}>
            None yet. Align the traces below and compile a candidate.
          </p>
        ) : (
          <ul className="learn-versions">
            {versions.map((v) => (
              <li key={v.id}>
                <ReflexGlyph hash={v.contentHash} size={28} />
                <Link to={reflexPath(v.id)} className="learn-versions__link">
                  {v.name} <span className="mono">v{v.version}</span>
                </Link>
                <StatusChip status={v.status} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The right-hand inspector of the Learn page: a task (why it matched) or a family (what it is). */
export function FamilyInspector({
  view,
  family,
  node,
  nodesById,
  roles,
  versions,
  onSelectTask,
}: InspectorProps) {
  if (node) {
    return (
      <TaskView
        node={node}
        view={view}
        nodesById={nodesById}
        roles={roles}
        onSelectTask={onSelectTask}
      />
    );
  }
  if (family) return <FamilyView family={family} view={view} versions={versions} />;
  return (
    <p className="dim">
      Select a family or a task on the map to see what it is and why it matched.
    </p>
  );
}
