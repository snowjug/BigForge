import type {
  FamilyMatch,
  ReflexListDto,
  ReflexVersionSummaryDto,
  RunSummaryDto,
  ScenarioDto,
  TaskDetailDto,
} from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import { countRedactions, levelOf, parseLog, splitRedactions } from '../../src/pages/run/log';
import {
  comparisonKindFor,
  defaultRun,
  groupScenarios,
  newestVersionOf,
  nextScenario,
  pathVerdict,
  relationsOf,
  runAvailability,
  scenarioState,
  selectExecutable,
} from '../../src/pages/run/selectors';
import taskJson from './fixtures/k1-task.json';

const task = taskJson as unknown as TaskDetailDto;
const rootFailure = task.runs[0]?.rootFailure ?? null;

describe('parseLog', () => {
  const model = parseLog(task.originalLog, rootFailure);

  it('numbers lines and classifies their severity', () => {
    expect(model.lines[0]?.n).toBe(1);
    expect(model.lines.length).toBeGreaterThan(60);
    expect(levelOf('[00:00.152] packages/auth  \u2716 error TS2305: Module')).toBe('error');
    expect(levelOf('[00:00.002] packages/core  \u26a0 warn cache miss')).toBe('warn');
    expect(levelOf('[00:00.016] packages/core  \u2714 built in 15ms')).toBe('ok');
    expect(levelOf('\u25b8 plan 8 workspaces')).toBe('info');
    expect(levelOf('plain text')).toBe('plain');
  });

  it('shows where the planted secret was redacted', () => {
    expect(model.totalRedactions).toBe(1);
    expect(model.redactions).toEqual([{ kind: 'forge_token', count: 1 }]);
    const line = model.lines.find((entry) => entry.text.includes('FORGE_REGISTRY_TOKEN'));
    expect(line?.segments.some((segment) => segment.redacted === 'forge_token')).toBe(true);
    expect(line?.text).not.toMatch(/forge_[a-z]+_[A-Za-z0-9]{8,}/);
  });

  it('marks the recorded root cause (error line and its location) and nothing else as root', () => {
    expect(model.rootLines).toHaveLength(2);
    const roots = model.lines.filter((line) => line.root);
    expect(roots[0]?.text).toContain('TS2305');
    expect(roots[0]?.text).toContain('packages/auth');
    expect(roots[1]?.text).toContain('packages/auth/src/session.ts:1');
    expect(roots.every((line) => !line.consequence)).toBe(true);
  });

  it('marks the other errors as consequences and counts error lines, not "build failed" lines', () => {
    expect(model.errorCount).toBe(3);
    const consequences = model.lines.filter(
      (line) => line.consequence && /error TS/.test(line.text),
    );
    expect(consequences).toHaveLength(2);
    expect(consequences.every((line) => line.text.includes('TS2307'))).toBe(true);
  });

  it('marks no root cause without a recorded failure, and copes with no log', () => {
    expect(parseLog(task.originalLog, null).rootLines).toEqual([]);
    const none = parseLog(null, rootFailure);
    expect(none.lines).toEqual([]);
    expect(none.totalRedactions).toBe(0);
  });

  it('splits redaction markers out of a line', () => {
    expect(splitRedactions('token=[REDACTED:api_key] and [REDACTED:email]')).toEqual([
      { text: 'token=', redacted: null },
      { text: '[REDACTED:api_key]', redacted: 'api_key' },
      { text: ' and ', redacted: null },
      { text: '[REDACTED:email]', redacted: 'email' },
    ]);
    expect(splitRedactions('nothing here')).toEqual([{ text: 'nothing here', redacted: null }]);
    expect(countRedactions('[REDACTED:a] [REDACTED:b] [REDACTED:a]')).toEqual([
      { kind: 'a', count: 2 },
      { kind: 'b', count: 1 },
    ]);
  });
});

const scenario = (
  id: string,
  role: ScenarioDto['role'],
  taskId: string | null = null,
): ScenarioDto => ({
  id,
  role,
  fault: 'missing_export',
  workspace: 'packages/auth',
  ambiguous: false,
  variantKey: id,
  title: id,
  prompt: '',
  taskId,
  taskStatus: taskId ? 'solved' : null,
});

describe('scenario selectors', () => {
  const catalogue = [
    scenario('L1', 'learning'),
    scenario('L2', 'learning'),
    scenario('S1', 'shadow'),
    scenario('K1', 'held_out'),
  ];

  it('groups learning, then held-out, then shadow', () => {
    expect(
      groupScenarios(catalogue).map((group) => [group.role, group.items.map((item) => item.id)]),
    ).toEqual([
      ['learning', ['L1', 'L2']],
      ['held_out', ['K1']],
      ['shadow', ['S1']],
    ]);
    expect(groupScenarios([])).toEqual([]);
  });

  it('proposes the first failure that has not been sent', () => {
    expect(nextScenario(catalogue)?.id).toBe('L1');
    expect(nextScenario([scenario('L1', 'learning', 't1'), ...catalogue.slice(1)])?.id).toBe('L2');
    const learned = [
      scenario('L1', 'learning', 't1'),
      scenario('L2', 'learning', 't2'),
      scenario('S1', 'shadow'),
      scenario('K1', 'held_out'),
    ];
    expect(nextScenario(learned)?.id).toBe('K1');
    expect(nextScenario([scenario('L1', 'learning', 't1')])?.id).toBe('L1');
    expect(nextScenario([])).toBeNull();
  });

  it('reports a scenario without a task as not sent', () => {
    expect(scenarioState(scenario('L1', 'learning'))).toBe('not_sent');
    expect(scenarioState(scenario('L1', 'learning', 't'))).toBe('solved');
  });
});

describe('run selection and pairing', () => {
  const runs = task.runs;
  const reflex = runs.find((run) => run.kind === 'reflex') as RunSummaryDto;
  const baseline = runs.find((run) => run.kind === 'baseline') as RunSummaryDto;

  it('defaults to the live Reflex run, then a standalone baseline, then anything', () => {
    expect(defaultRun(runs)?.id).toBe(reflex.id);
    expect(defaultRun([baseline])?.id).toBe(baseline.id);
    const standalone = { ...baseline, id: 'solo', groupId: null };
    expect(defaultRun([baseline, standalone])?.id).toBe('solo');
    expect(defaultRun([])).toBeNull();
    const replay = { ...reflex, id: 'rp', kind: 'replay_reflex' as const };
    expect(defaultRun([replay])?.id).toBe('rp');
  });

  it('pairs the reference baseline with its Reflex run through the group', () => {
    expect(relationsOf(baseline, runs, baseline.id)).toMatchObject({
      role: 'reference',
      partner: { id: reflex.id },
    });
    expect(relationsOf(reflex, runs, baseline.id)).toEqual({
      partner: null,
      role: null,
      fallback: null,
    });
  });

  it('finds the fallback baseline when the Reflex stopped', () => {
    const stopped = { ...reflex, status: 'stopped' };
    const fallback = { ...baseline, id: 'fb', createdAt: '2026-11-06T10:00:00Z' };
    const all = [stopped, baseline, fallback];
    expect(relationsOf(stopped, all, baseline.id).fallback?.id).toBe('fb');
    expect(relationsOf(fallback, all, baseline.id).role).toBe('fallback');
    expect(relationsOf(baseline, all, baseline.id).role).toBe('reference');
    expect(relationsOf(stopped, [stopped, fallback], null).fallback?.id).toBe('fb');
  });

  it('has no relations for a standalone run', () => {
    const solo = { ...baseline, groupId: null };
    expect(relationsOf(solo, [solo], null)).toEqual({ partner: null, role: null, fallback: null });
  });

  it('maps a Reflex run kind to its comparison kind', () => {
    expect(comparisonKindFor('reflex')).toBe('live');
    expect(comparisonKindFor('shadow_reflex')).toBe('shadow');
    expect(comparisonKindFor('canary_reflex')).toBe('canary');
    expect(comparisonKindFor('replay_reflex')).toBe('replay');
    expect(comparisonKindFor('baseline')).toBeNull();
  });
});

const version = (
  status: ReflexVersionSummaryDto['status'],
  v: string,
): ReflexVersionSummaryDto => ({
  id: `rfv_${v}`,
  reflexId: 'rfx',
  name: 'first-causal-error',
  version: v,
  status,
  confidence: 0.9,
  trust: { confidence: 0.9, successes: 9, n: 10, interval: { low: 0.6, high: 0.97 } },
  contentHash: 'sha256:x',
  familyId: 'fam_1',
  stepCount: 13,
  createdAt: '',
  updatedAt: '',
  mutationOf: null,
});
const registry: ReflexListDto[] = [
  {
    reflexId: 'rfx',
    name: 'first-causal-error',
    familyId: 'fam_1',
    versions: [version('active', '1.0.0'), version('candidate', '1.1.0')],
  },
];
const match = (decision: FamilyMatch['decision']): FamilyMatch => ({
  decision,
  familyId: decision === 'no_match' ? null : 'fam_1',
  familyName: 'Monorepo build failure',
  score: decision === 'no_match' ? 0.42 : 0.975,
  threshold: 0.8,
  hardGates: [],
  features: [],
  reasons: [],
});

describe('Reflex selection and action availability', () => {
  it('picks the newest version that may execute live', () => {
    expect(selectExecutable(registry, 'fam_1')?.version.version).toBe('1.0.0');
    expect(selectExecutable(registry, 'fam_2')).toBeNull();
    expect(selectExecutable(undefined, 'fam_1')).toBeNull();
    const shadowOnly: ReflexListDto[] = [
      { ...registry[0]!, versions: [version('shadow', '1.0.0')] },
    ];
    expect(selectExecutable(shadowOnly, 'fam_1')).toBeNull();
    expect(newestVersionOf(shadowOnly, 'fam_1')?.version.status).toBe('shadow');
    const watch: ReflexListDto[] = [
      { ...registry[0]!, versions: [version('watch', '1.0.0'), version('active', '1.2.0')] },
    ];
    expect(selectExecutable(watch, 'fam_1')?.version.version).toBe('1.2.0');
  });

  it('enables every path when a Reflex applies', () => {
    const choice = selectExecutable(registry, 'fam_1');
    const result = runAvailability({
      canRun: true,
      taskStatus: 'received',
      match: match('match'),
      choice,
      newest: choice,
    });
    expect(result.baseline.enabled && result.auto.enabled && result.compare.enabled).toBe(true);
    expect(pathVerdict({ match: match('match'), choice })).toEqual({
      path: 'reflex',
      label: 'Reflex first-causal-error v1.0.0',
    });
  });

  it('explains why a Reflex cannot run', () => {
    const noMatch = runAvailability({
      canRun: true,
      taskStatus: 'received',
      match: match('no_match'),
      choice: null,
      newest: null,
    });
    expect(noMatch.baseline.enabled).toBe(true);
    expect(noMatch.auto).toMatchObject({ enabled: false });
    expect(noMatch.auto.reason).toContain('42.0%');
    expect(noMatch.auto.reason).toContain('80.0%');
    const shadow = newestVersionOf(
      [{ ...registry[0]!, versions: [version('shadow', '1.0.0')] }],
      'fam_1',
    );
    const waiting = runAvailability({
      canRun: true,
      taskStatus: 'received',
      match: match('match'),
      choice: null,
      newest: shadow,
    });
    expect(waiting.compare.reason).toContain('shadow');
    expect(waiting.compare.reason).toContain('promote');
    expect(
      runAvailability({
        canRun: true,
        taskStatus: 'received',
        match: match('ambiguous'),
        choice: null,
        newest: null,
      }).auto.reason,
    ).toContain('ambiguous');
    expect(
      runAvailability({
        canRun: true,
        taskStatus: 'received',
        match: null,
        choice: null,
        newest: null,
      }).auto.reason,
    ).toContain('not been matched');
    expect(pathVerdict({ match: match('no_match'), choice: null }).path).toBe('baseline');
  });

  it('blocks read-only roles and observed tasks everywhere, with a reason', () => {
    const viewer = runAvailability({
      canRun: false,
      taskStatus: 'received',
      match: match('match'),
      choice: null,
      newest: null,
    });
    for (const mode of [viewer.baseline, viewer.auto, viewer.compare]) {
      expect(mode.enabled).toBe(false);
      expect(mode.reason).toContain('operator');
    }
    const observed = runAvailability({
      canRun: true,
      taskStatus: 'observed',
      match: null,
      choice: null,
      newest: null,
    });
    expect(observed.baseline.enabled).toBe(false);
    expect(observed.baseline.reason).toContain('observed');
  });
});
