import { describe, expect, it } from 'vitest';
import { type ForgeFacts, describeForge } from '../src/pages/forgeState';

const cold: ForgeFacts = {
  runs: 0,
  families: 0,
  versionStatuses: [],
  liveExecutions: 0,
  driftChecks: 0,
  latestDriftDetected: null,
  proposedMutations: 0,
};

describe('describeForge', () => {
  it('is cold when nothing has run', () => {
    const state = describeForge(cold);
    expect(state.stage).toBeNull();
    expect(state.headline).toBe('The forge is cold.');
  });

  it('walks the loop from observing to executing', () => {
    expect(describeForge({ ...cold, runs: 5 }).stage).toBe('observe');
    expect(describeForge({ ...cold, runs: 5, families: 1 }).stage).toBe('compile');
    expect(
      describeForge({ ...cold, runs: 5, families: 1, versionStatuses: ['shadow'] }).stage,
    ).toBe('validate');
    const awaiting = describeForge({
      ...cold,
      runs: 20,
      families: 1,
      versionStatuses: ['approval'],
    });
    expect(awaiting.stage).toBe('validate');
    expect(awaiting.headline).toContain('human');
    const active = describeForge({
      ...cold,
      runs: 20,
      families: 1,
      versionStatuses: ['active'],
      liveExecutions: 2,
    });
    expect(active.stage).toBe('execute');
    expect(active.detail).toContain('2 live executions');
  });

  it('reports an active Reflex that has not executed yet', () => {
    const state = describeForge({ ...cold, runs: 20, families: 1, versionStatuses: ['active'] });
    expect(state.headline).toBe('A Reflex is active.');
  });

  it('lets drift outrank everything and mentions pending mutations', () => {
    const drifted = describeForge({
      ...cold,
      runs: 40,
      families: 1,
      versionStatuses: ['shadow'],
      driftChecks: 1,
      latestDriftDetected: true,
      proposedMutations: 1,
    });
    expect(drifted.stage).toBe('evolve');
    expect(drifted.headline).toBe('The world changed.');
    expect(drifted.detail).toContain('1 mutation proposed');
  });

  it('shows a waiting mutation even without drift', () => {
    const waiting = describeForge({
      ...cold,
      versionStatuses: ['active'],
      driftChecks: 1,
      latestDriftDetected: false,
      proposedMutations: 2,
    });
    expect(waiting.headline).toBe('A mutation is waiting.');
    expect(waiting.detail).toContain('2 proposed mutations');
  });
});
