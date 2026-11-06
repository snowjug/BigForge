import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LEARNING_IDS } from '@bigforge/lab-monorepo';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { type Actor, Platform, loadConfig } from '../src';

let dir: string;
let platform: Platform;
let grace: Actor;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'bf-adopt-'));
  platform = await Platform.create({
    ...loadConfig({ BIGFORGE_DATA_DIR: dir }),
    databaseFile: ':memory:',
  });
  grace = platform.actorFor('usr_grace') as Actor;
});
afterAll(async () => {
  platform.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the guided demo adopts work done from the regular pages', () => {
  it('does not repeat, duplicate or fail on steps whose work already exists', async () => {
    const ts = platform.store.forTenant(grace.tenantId);

    // Everything the learning, validation and promotion steps do, done the way the pages do it.
    for (const id of LEARNING_IDS) {
      const task = await platform.tasks.intake(grace, id);
      await platform.tasks.run(grace, task.id, 'baseline');
    }
    const view = await platform.learning.discoverFamilies(grace);
    const family = view.families[0];
    if (!family) throw new Error('expected a discovered family');
    const candidate = await platform.learning.compile(grace, family.id);
    await platform.validation.replay(grace, candidate.id);
    await platform.validation.shadow(grace, candidate.id);
    platform.validation.promote(grace, candidate.id, 'Promoted from the Reflexes page');

    const tasksBefore = ts.tasks.all(ts.tenantId).length;
    const runsBefore = ts.runs.all(ts.tenantId).length;

    // The presenter then catches up through the promotion without redoing any of it.
    const state = await platform.demo.perform(grace, 11);
    expect(state.completed).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
    expect(state.context.reflexVersionId).toBe(candidate.id);
    expect(ts.versions.all(ts.tenantId)).toHaveLength(1);
    expect(ts.approvals.all(ts.tenantId, { where: { action: 'promote' } })).toHaveLength(1);
    // Steps 1 and 2 adopted the first task and its baseline run, step 4 found the rest already solved, and
    // only the three unrelated "noise" tasks of step 5 are new: no extra tasks, runs or versions.
    expect(
      ts.tasks.all(ts.tenantId, { where: { scenarioId: LEARNING_IDS[0] ?? '' } }),
    ).toHaveLength(1);
    expect(ts.tasks.all(ts.tenantId).length - tasksBefore).toBe(3);
    expect(ts.runs.all(ts.tenantId)).toHaveLength(runsBefore);

    // The drift half: the canary and the mutation proposal done from the Drift page first.
    await platform.demo.perform(grace, 20);
    platform.tasks.setEnvironment(grace, '1.5.0');
    const check = await platform.drift.canary(grace, candidate.id);
    const mutation = await platform.drift.proposeMutation(grace, candidate.id);

    const done = await platform.demo.perform(grace, 25);
    expect(done.completed).toHaveLength(25);
    expect(done.context.driftCheckId).toBe(check.id);
    expect(done.context.mutationId).toBe(mutation.id);
    expect(ts.driftChecks.all(ts.tenantId)).toHaveLength(1);
    expect(ts.mutations.all(ts.tenantId)).toHaveLength(1);
    expect(ts.verifyAudit().ok).toBe(true);
  }, 600_000);
});
