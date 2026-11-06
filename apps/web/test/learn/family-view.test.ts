import type { FamiliesViewDto, MatcherEvaluation } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  closestGroup,
  discoveryGap,
  groupVariants,
  learnState,
  matcherFigures,
  nodeRoleLabel,
  splitVariantKey,
} from '../../src/pages/learn/familyView';

const thresholds = { match: 0.8, cluster: 0.75, minMembers: 3, minVariants: 2 };
const node = (id: string, variantKey: string): FamiliesViewDto['nodes'][number] => ({
  taskId: id,
  scenarioId: id.toUpperCase(),
  variantKey,
  title: id,
  familyId: null,
  intent: 'diagnose_build_failure',
  failureType: 'build',
  toolchain: 'forge-ci',
  origin: 'intake',
});

describe('learnState', () => {
  it('is no_tasks without any task', () => {
    expect(learnState({ families: [], nodes: [], edges: [], thresholds })).toEqual({
      kind: 'no_tasks',
    });
  });

  it('is no_family when tasks exist but none cluster, and names the closest group', () => {
    const view = {
      families: [],
      nodes: [
        node('a', 'missing_dependency@x'),
        node('b', 'missing_dependency@x'),
        node('c', 'other'),
      ],
      edges: [
        { a: 'a', b: 'b', score: 0.9 },
        { a: 'b', b: 'c', score: 0.4 },
      ],
      thresholds,
    };
    const state = learnState(view);
    expect(state).toMatchObject({
      kind: 'no_family',
      tasks: 3,
      variants: 2,
      closest: { tasks: 2, variants: 1 },
    });
    if (state.kind !== 'no_family') throw new Error('unexpected');
    expect(discoveryGap(state, thresholds)).toBe(
      'So far the closest group has 2 tasks (needs 3) and 1 distinct variant (needs 2).',
    );
  });

  it('is ready once a family exists', () => {
    const view = {
      families: [{ id: 'f' }] as unknown as FamiliesViewDto['families'],
      nodes: [node('a', 'v')],
      edges: [],
      thresholds,
    };
    expect(learnState(view)).toEqual({ kind: 'ready' });
  });
});

describe('closestGroup', () => {
  it('ignores edges below the cluster threshold and returns null for no tasks', () => {
    expect(closestGroup({ families: [], nodes: [], edges: [], thresholds })).toBeNull();
    const group = closestGroup({
      families: [],
      nodes: [node('a', 'v1'), node('b', 'v2'), node('c', 'v3')],
      edges: [
        { a: 'a', b: 'b', score: 0.74 },
        { a: 'b', b: 'c', score: 0.76 },
      ],
      thresholds,
    });
    expect(group).toEqual({ tasks: 2, variants: 2 });
  });
});

describe('variants', () => {
  it('splits fault and workspace', () => {
    expect(splitVariantKey('missing_export+ambiguous@packages/auth')).toEqual({
      fault: 'missing_export+ambiguous',
      workspace: 'packages/auth',
    });
    expect(splitVariantKey('out-of-scope')).toEqual({ fault: 'out-of-scope', workspace: null });
  });

  it('groups tasks sharing a variant', () => {
    const groups = groupVariants([node('a', 'x@1'), node('b', 'x@1'), node('c', 'y@2')]);
    expect(groups.map((g) => [g.variantKey, g.taskIds.length])).toEqual([
      ['x@1', 2],
      ['y@2', 1],
    ]);
  });

  it('labels the role of a task', () => {
    const roles = new Map([['L1', 'learning' as const]]);
    expect(nodeRoleLabel({ origin: 'intake', scenarioId: 'L1' }, roles)).toBe('Learning task');
    expect(nodeRoleLabel({ origin: 'noise', scenarioId: 'N2' }, roles)).toBe('Unrelated task');
    expect(nodeRoleLabel({ origin: 'intake', scenarioId: 'Z9' }, roles)).toBe('Task');
  });
});

describe('matcherFigures', () => {
  const evaluation: MatcherEvaluation = {
    provenance: 'measured',
    corpus: 'synthetic',
    positives: 18,
    negatives: 12,
    truePositives: 18,
    falseMatches: 0,
    falseMatchRate: 0,
    recall: 1,
    threshold: 0.8,
    misses: [],
    falseMatchExamples: [],
  };

  it('keeps the false-match rate first-class and reports the corpus size', () => {
    expect(matcherFigures(evaluation)).toMatchObject({
      falseMatchRate: 0,
      corpusSize: 30,
      clean: true,
    });
  });

  it('is not clean when a task was missed or matched wrongly', () => {
    expect(matcherFigures({ ...evaluation, falseMatches: 1, falseMatchRate: 1 / 12 }).clean).toBe(
      false,
    );
    expect(matcherFigures({ ...evaluation, misses: [{ label: 'x', score: 0.7 }] }).clean).toBe(
      false,
    );
  });
});
