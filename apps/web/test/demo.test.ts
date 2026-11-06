import type { DemoContext, DemoStepDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import { demoRoute } from '../src/demo/demoRoute';
import {
  groupScenes,
  nextBlockedReason,
  pendingBefore,
  seedBlockedReason,
} from '../src/demo/scenes';
import {
  DEMO_STEP_STAGES,
  FORGE_STAGES,
  pathRoot,
  resolveActiveStages,
  stagesForPath,
} from '../src/stages';

/** The 25 steps as the demo director defines them (id, route, scene, kind). */
const STEPS: [string, string, string, DemoStepDto['kind']][] = [
  ['failure_enters', '/run', 'Cold start', 'action'],
  ['baseline_handles', '/run', 'Cold start', 'action'],
  ['trace_captured', '/traces', 'Cold start', 'view'],
  ['variations', '/run', 'Learning', 'action'],
  ['family_found', '/learn', 'Learning', 'action'],
  ['invariants', '/learn', 'Learning', 'action'],
  ['candidate', '/reflexes', 'Learning', 'view'],
  ['replay', '/shadow', 'Validation', 'action'],
  ['shadow', '/shadow', 'Validation', 'action'],
  ['compare', '/shadow', 'Validation', 'view'],
  ['promote', '/reflexes', 'Validation', 'human'],
  ['new_task', '/run', 'The killer moment', 'action'],
  ['recognized', '/run', 'The killer moment', 'view'],
  ['known_steps', '/run', 'The killer moment', 'action'],
  ['boundary', '/run', 'The killer moment', 'view'],
  ['firewall', '/run', 'The killer moment', 'view'],
  ['ai_resolves', '/run', 'The killer moment', 'view'],
  ['continues', '/run', 'The killer moment', 'view'],
  ['verified', '/run', 'The killer moment', 'view'],
  ['comparison', '/run', 'The killer moment', 'view'],
  ['env_change', '/drift', 'Drift', 'action'],
  ['canary', '/drift', 'Drift', 'action'],
  ['confidence_falls', '/drift', 'Drift', 'view'],
  ['back_to_shadow', '/reflexes', 'Drift', 'view'],
  ['mutation', '/drift', 'Drift', 'action'],
];

const steps: DemoStepDto[] = STEPS.map(([id, route, scene, kind], index) => ({
  n: index + 1,
  id,
  title: id,
  narration: '',
  scene,
  route,
  kind,
  actionLabel: kind === 'view' ? null : `Do ${id}`,
  done: false,
}));

const empty: DemoContext = {
  taskIds: {},
  familyId: null,
  reflexVersionId: null,
  mutatedVersionId: null,
  firstRunId: null,
  killerRunId: null,
  killerReferenceRunId: null,
  driftCheckId: null,
  mutationId: null,
};

const full: DemoContext = {
  taskIds: { L1: 'tsk_L1', L2: 'tsk_L2', K1: 'tsk_K1' },
  familyId: 'fam_1',
  reflexVersionId: 'rfv_1',
  mutatedVersionId: 'rfv_2',
  firstRunId: 'run_first',
  killerRunId: 'run_killer',
  killerReferenceRunId: 'run_ref',
  driftCheckId: 'drf_1',
  mutationId: 'mut_1',
};

const route = (id: string, context: DemoContext) => {
  const step = steps.find((candidate) => candidate.id === id);
  if (!step) throw new Error(`no step ${id}`);
  return demoRoute(step, context);
};

describe('demoRoute', () => {
  it('lands every step on a valid page even before any id exists', () => {
    for (const step of steps) {
      expect(demoRoute(step, empty)).toMatch(/^\/[a-z]*(\/|\?|$)/);
    }
    expect(route('failure_enters', empty)).toBe('/run');
    expect(route('candidate', empty)).toBe('/reflexes');
    expect(route('replay', empty)).toBe('/shadow');
  });

  it('follows the cold-start task and its first run', () => {
    expect(route('failure_enters', full)).toBe('/run?task=tsk_L1');
    expect(route('baseline_handles', full)).toBe('/run?task=tsk_L1&run=run_first');
    expect(route('variations', full)).toBe('/run?task=tsk_L1');
    expect(route('trace_captured', full)).toBe('/traces/run_first');
  });

  it('follows the held-out task and the killer run through the whole killer scene', () => {
    for (const id of [
      'new_task',
      'recognized',
      'known_steps',
      'boundary',
      'firewall',
      'ai_resolves',
      'continues',
      'verified',
      'comparison',
    ]) {
      expect(route(id, full)).toBe('/run?task=tsk_K1&run=run_killer');
    }
    expect(route('new_task', { ...full, killerRunId: null })).toBe('/run?task=tsk_K1');
  });

  it('deep-links learning, validation and drift pages with the demo ids', () => {
    expect(route('family_found', full)).toBe('/learn?family=fam_1');
    expect(route('invariants', empty)).toBe('/learn');
    expect(route('candidate', full)).toBe('/reflexes/rfv_1');
    expect(route('promote', full)).toBe('/reflexes/rfv_1');
    expect(route('shadow', full)).toBe('/shadow?version=rfv_1');
    expect(route('canary', full)).toBe('/drift?version=rfv_1');
    expect(route('back_to_shadow', full)).toBe('/reflexes/rfv_1');
    expect(route('mutation', full)).toBe('/drift?version=rfv_1');
  });

  it('falls back to the server route for a page it does not know, and rejects unsafe ones', () => {
    expect(demoRoute({ id: 'x', route: '/economics' }, full)).toBe('/economics');
    expect(demoRoute({ id: 'x', route: '/governance' }, full)).toBe('/governance');
    expect(demoRoute({ id: 'x', route: 'https://evil.example' }, full)).toBe('/');
  });
});

describe('scene grouping', () => {
  it('groups the 25 steps into the five scenes in order', () => {
    const groups = groupScenes(steps);
    expect(groups.map((group) => group.name)).toEqual([
      'Cold start',
      'Learning',
      'Validation',
      'The killer moment',
      'Drift',
    ]);
    expect(groups.map((group) => group.steps.length)).toEqual([3, 4, 4, 9, 5]);
    expect(groups.map((group) => [group.first, group.last])).toEqual([
      [1, 3],
      [4, 7],
      [8, 11],
      [12, 20],
      [21, 25],
    ]);
  });

  it('counts completed steps per scene', () => {
    const done = steps.map((step) => ({ ...step, done: step.n <= 5 }));
    expect(groupScenes(done).map((group) => group.doneCount)).toEqual([3, 2, 0, 0, 0]);
  });

  it('lists the earlier steps a perform call would run first', () => {
    const done = steps.map((step) => ({ ...step, done: step.n === 1 || step.n === 3 }));
    expect(pendingBefore(done, 5).map((step) => step.n)).toEqual([2, 4]);
    expect(pendingBefore(done, 1)).toEqual([]);
  });

  it('blocks Next on an unfinished action or human step only', () => {
    const [view, action, human] = [
      steps.find((s) => s.kind === 'view'),
      steps.find((s) => s.kind === 'action'),
      steps.find((s) => s.kind === 'human'),
    ];
    expect(nextBlockedReason(view)).toBeNull();
    expect(nextBlockedReason(action)).toContain('Do failure_enters');
    expect(nextBlockedReason(human)).toContain('Do promote');
    expect(nextBlockedReason(action && { ...action, done: true })).toBeNull();
    expect(nextBlockedReason(undefined)).toContain('not loaded');
  });
});

describe('forge stages', () => {
  it('has the seven stages of the loop in order', () => {
    expect(FORGE_STAGES.map((stage) => stage.label)).toEqual([
      'Observe',
      'Fingerprint',
      'Compile',
      'Validate',
      'Execute',
      'Escalate',
      'Evolve',
    ]);
  });

  it('derives the stage from the route and ignores query strings and ids', () => {
    expect(stagesForPath('/run')).toEqual(['execute']);
    expect(stagesForPath('/run?task=tsk_1&run=run_2')).toEqual(['execute']);
    expect(stagesForPath('/traces/run_9')).toEqual(['observe']);
    expect(stagesForPath('/learn')).toEqual(['fingerprint', 'compile']);
    expect(stagesForPath('/reflexes/rfv_1')).toEqual(['validate']);
    expect(stagesForPath('/shadow?version=rfv_1')).toEqual(['validate']);
    expect(stagesForPath('/drift')).toEqual(['evolve']);
    for (const none of ['/', '/economics', '/governance', '/settings', '/login', '/nowhere']) {
      expect(stagesForPath(none)).toEqual([]);
    }
    expect(pathRoot('/reflexes/abc?x=1')).toBe('/reflexes');
    expect(pathRoot('/')).toBe('/');
  });

  it('knows a stage for every demo step', () => {
    for (const step of steps) {
      expect(DEMO_STEP_STAGES[step.id], step.id).toBeDefined();
    }
  });

  it('lets a page override beat the demo step, which beats the route', () => {
    const base = { demo: { stepId: 'firewall', route: '/run' }, pathname: '/run?task=x' };
    expect(resolveActiveStages({ ...base, page: ['evolve'] })).toEqual(['evolve']);
    expect(resolveActiveStages({ ...base, page: null })).toEqual(['escalate']);
    expect(resolveActiveStages({ ...base, page: null, demo: null })).toEqual(['execute']);
  });

  it('ignores the demo step once the user is on a different page', () => {
    expect(
      resolveActiveStages({
        page: null,
        demo: { stepId: 'firewall', route: '/run' },
        pathname: '/governance',
      }),
    ).toEqual([]);
  });
});

describe('seedBlockedReason (mirrors the server fast-forward rule)', () => {
  const operator = { canRun: true, canPromote: false, promotionDone: false };

  it('lets an operator seed only the stages before the human promotion', () => {
    expect(seedBlockedReason('learned', operator)).toBeNull();
    expect(seedBlockedReason('validated', operator)).toBeNull();
    for (const stage of ['promoted', 'killer', 'drifted', 'complete'] as const) {
      expect(seedBlockedReason(stage, operator), stage).toMatch(/reviewer or admin/);
    }
  });

  it('lets a promoting role seed every stage', () => {
    for (const stage of ['learned', 'promoted', 'complete'] as const) {
      expect(seedBlockedReason(stage, { ...operator, canPromote: true })).toBeNull();
    }
  });

  it('lets an operator go beyond promotion once a reviewer has promoted', () => {
    expect(seedBlockedReason('killer', { ...operator, promotionDone: true })).toBeNull();
  });

  it('blocks roles that cannot run tasks', () => {
    const viewer = { canRun: false, canPromote: false, promotionDone: true };
    expect(seedBlockedReason('learned', viewer)).toMatch(/operator, reviewer or admin/);
  });
});
