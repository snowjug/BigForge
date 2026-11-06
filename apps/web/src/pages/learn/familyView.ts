import type {
  FamiliesViewDto,
  FamilyNodeDto,
  Fingerprint,
  MatcherEvaluation,
} from '@bigforge/schemas';

/** Pure selectors for the Learn page: what state is it in, what explains it, what does the matcher say. */

export type LearnState =
  /** No task has been received yet: nothing can repeat. */
  | { kind: 'no_tasks' }
  /** Tasks exist but no group met the discovery thresholds. */
  | { kind: 'no_family'; tasks: number; variants: number; closest: GroupSummary | null }
  | { kind: 'ready' };

export interface GroupSummary {
  tasks: number;
  variants: number;
}

type ViewLike = Pick<FamiliesViewDto, 'families' | 'nodes' | 'edges' | 'thresholds'>;

/** Tasks that look alike at the cluster threshold: the largest connected group of the similarity graph. */
export function closestGroup(view: ViewLike): GroupSummary | null {
  const parent = new Map(view.nodes.map((n) => [n.taskId, n.taskId]));
  const find = (id: string): string => {
    let root = id;
    for (;;) {
      const up = parent.get(root);
      if (up === undefined || up === root) return root;
      root = up;
    }
  };
  for (const edge of view.edges) {
    if (edge.score < view.thresholds.cluster) continue;
    if (!parent.has(edge.a) || !parent.has(edge.b)) continue;
    parent.set(find(edge.a), find(edge.b));
  }
  const groups = new Map<string, FamilyNodeDto[]>();
  for (const node of view.nodes) {
    const root = find(node.taskId);
    const list = groups.get(root);
    if (list) list.push(node);
    else groups.set(root, [node]);
  }
  let best: GroupSummary | null = null;
  for (const members of groups.values()) {
    const candidate = {
      tasks: members.length,
      variants: new Set(members.map((m) => m.variantKey)).size,
    };
    if (
      !best ||
      candidate.tasks > best.tasks ||
      (candidate.tasks === best.tasks && candidate.variants > best.variants)
    ) {
      best = candidate;
    }
  }
  return best;
}

export function learnState(view: ViewLike): LearnState {
  if (view.nodes.length === 0) return { kind: 'no_tasks' };
  if (view.families.length === 0) {
    return {
      kind: 'no_family',
      tasks: view.nodes.length,
      variants: new Set(view.nodes.map((n) => n.variantKey)).size,
      closest: closestGroup(view),
    };
  }
  return { kind: 'ready' };
}

/** Which unmet discovery threshold is the blocker, in words. */
export function discoveryGap(
  state: Extract<LearnState, { kind: 'no_family' }>,
  thresholds: ViewLike['thresholds'],
): string {
  const closest = state.closest;
  if (!closest) return 'No tasks resemble each other yet.';
  const parts: string[] = [];
  if (closest.tasks < thresholds.minMembers) {
    parts.push(
      `the closest group has ${closest.tasks} ${closest.tasks === 1 ? 'task' : 'tasks'} (needs ${thresholds.minMembers})`,
    );
  }
  if (closest.variants < thresholds.minVariants) {
    parts.push(
      `${closest.variants} distinct ${closest.variants === 1 ? 'variant' : 'variants'} (needs ${thresholds.minVariants})`,
    );
  }
  if (parts.length === 0) return 'The thresholds look met: discover families to cluster the tasks.';
  return `So far ${parts.join(' and ')}.`;
}

export interface VariantGroup {
  variantKey: string;
  fault: string;
  workspace: string | null;
  taskIds: string[];
  scenarioIds: string[];
}

/** `missing_export+ambiguous@packages/auth` -> fault `missing_export+ambiguous`, workspace `packages/auth`. */
export function splitVariantKey(variantKey: string): { fault: string; workspace: string | null } {
  const at = variantKey.indexOf('@');
  return at < 0
    ? { fault: variantKey, workspace: null }
    : { fault: variantKey.slice(0, at), workspace: variantKey.slice(at + 1) };
}

export function groupVariants(nodes: readonly FamilyNodeDto[]): VariantGroup[] {
  const groups = new Map<string, VariantGroup>();
  for (const node of nodes) {
    const existing = groups.get(node.variantKey);
    if (existing) {
      existing.taskIds.push(node.taskId);
      existing.scenarioIds.push(node.scenarioId);
    } else {
      groups.set(node.variantKey, {
        variantKey: node.variantKey,
        ...splitVariantKey(node.variantKey),
        taskIds: [node.taskId],
        scenarioIds: [node.scenarioId],
      });
    }
  }
  return [...groups.values()].sort((a, b) => a.variantKey.localeCompare(b.variantKey));
}

export type ScenarioRole = 'learning' | 'shadow' | 'held_out';

export const ROLE_LABEL: Record<ScenarioRole | 'noise', string> = {
  learning: 'Learning task',
  shadow: 'Shadow task',
  held_out: 'Held-out task',
  noise: 'Unrelated task',
};

export function nodeRoleLabel(
  node: Pick<FamilyNodeDto, 'origin' | 'scenarioId'>,
  roles: ReadonlyMap<string, ScenarioRole>,
): string {
  if (node.origin === 'noise') return ROLE_LABEL.noise;
  const role = roles.get(node.scenarioId);
  return role ? ROLE_LABEL[role] : 'Task';
}

export interface MatcherFigures {
  falseMatchRate: number;
  falseMatches: number;
  negatives: number;
  recall: number;
  truePositives: number;
  positives: number;
  corpusSize: number;
  threshold: number;
  /** True when every in-family task was recognised and no out-of-family task matched. */
  clean: boolean;
}

export function matcherFigures(evaluation: MatcherEvaluation): MatcherFigures {
  return {
    falseMatchRate: evaluation.falseMatchRate,
    falseMatches: evaluation.falseMatches,
    negatives: evaluation.negatives,
    recall: evaluation.recall,
    truePositives: evaluation.truePositives,
    positives: evaluation.positives,
    corpusSize: evaluation.positives + evaluation.negatives,
    threshold: evaluation.threshold,
    clean: evaluation.falseMatches === 0 && evaluation.misses.length === 0,
  };
}

/** The matcher's feature names -> the centroid fingerprint field they compare, for the weights table. */
export const FEATURE_FIELD: Readonly<Record<string, string>> = {
  intent: 'Intent',
  failure_type: 'Failure type',
  toolchain: 'Toolchain',
  error_signatures: 'Error signatures',
  repo_shape: 'Repository shape',
  files: 'Files touched',
  capabilities: 'Capabilities',
};

export interface CentroidRow {
  /** The matcher feature this row is scored under (see FEATURE_FIELD). */
  feature: string;
  label: string;
  value: string;
}

const list = (items: readonly string[]): string => (items.length > 0 ? items.join(', ') : 'none');

/** The centroid fingerprint as rows keyed by the matcher's feature names, so weights can be attached. */
export function centroidRows(centroid: Fingerprint): CentroidRow[] {
  return [
    {
      feature: 'intent',
      label: FEATURE_FIELD.intent as string,
      value: `${centroid.intent.label.replaceAll('_', ' ')} (confidence ${centroid.intent.confidence})`,
    },
    {
      feature: 'failure_type',
      label: FEATURE_FIELD.failure_type as string,
      value: `${centroid.failure.type}${centroid.failure.cascading ? ', cascading' : ''}`,
    },
    {
      feature: 'toolchain',
      label: FEATURE_FIELD.toolchain as string,
      value: `${centroid.toolchain.tool ?? 'unknown'} via ${centroid.toolchain.manager ?? 'unknown'}`,
    },
    {
      feature: 'error_signatures',
      label: FEATURE_FIELD.error_signatures as string,
      value: list(centroid.failure.signatures),
    },
    {
      feature: 'repo_shape',
      label: FEATURE_FIELD.repo_shape as string,
      value: `${centroid.repo.layout ?? 'unknown'}${centroid.repo.workspaceCount !== null ? `, ${centroid.repo.workspaceCount} workspaces` : ''}`,
    },
    { feature: 'files', label: FEATURE_FIELD.files as string, value: list(centroid.files) },
    {
      feature: 'capabilities',
      label: FEATURE_FIELD.capabilities as string,
      value: list(centroid.capabilities),
    },
  ];
}

export interface FaultGroup {
  fault: string;
  tasks: number;
  /** Distinct workspaces the fault was seen in, shortened to the last path segment. */
  workspaces: string[];
}

/** Variants rolled up by fault kind: `missing_export` seen in 5 workspaces. */
export function groupFaults(nodes: readonly FamilyNodeDto[]): FaultGroup[] {
  const groups = new Map<string, { tasks: number; workspaces: Set<string> }>();
  for (const node of nodes) {
    const { fault, workspace } = splitVariantKey(node.variantKey);
    const entry = groups.get(fault) ?? { tasks: 0, workspaces: new Set<string>() };
    entry.tasks += 1;
    if (workspace) entry.workspaces.add(workspace.split('/').pop() ?? workspace);
    groups.set(fault, entry);
  }
  return [...groups.entries()]
    .map(([fault, v]) => ({ fault, tasks: v.tasks, workspaces: [...v.workspaces].sort() }))
    .sort((a, b) => a.fault.localeCompare(b.fault));
}
