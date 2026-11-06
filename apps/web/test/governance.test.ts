import { describe, expect, it } from 'vitest';
import type { SecurityEvaluationDto } from '@bigforge/schemas';
import { PRESETS, stagesOf } from '../src/pages/governance/safety';
import {
  KNOWN_AUDIT_ACTIONS,
  actionOptions,
  actionTone,
  actionVerb,
  subjectLink,
} from '../src/pages/governance/audit';
import { ACTIONS, ROLES, can, rolesFor } from '../src/auth/rbac';

describe('audit helpers', () => {
  it('colours actions by namespace and makes failures stand out', () => {
    expect(actionTone('auth.login')).toBe('ash');
    expect(actionTone('task.received')).toBe('steel');
    expect(actionTone('reflex.promoted')).toBe('jade');
    expect(actionTone('mutation.proposed')).toBe('ember');
    expect(actionTone('reflex.integrity_failed')).toBe('crimson');
    expect(actionTone('reflex.rolled_back')).toBe('crimson');
    expect(actionTone('reflex.rejected')).toBe('amber');
    expect(actionTone('something.new')).toBe('neutral');
  });

  it('turns an action into a readable verb', () => {
    expect(actionVerb('reflex.rolled_back')).toBe('rolled back');
    expect(actionVerb('lab.environment_changed')).toBe('environment changed');
    expect(actionVerb('login')).toBe('login');
  });

  it('links subjects that have a page and skips the rest', () => {
    expect(subjectLink('reflex_version', 'rfx_1')).toBe('/reflexes/rfx_1');
    expect(subjectLink('task', 'tsk_1')).toBe('/run?task=tsk_1');
    expect(subjectLink('run', 'run_1')).toBe('/traces/run_1');
    expect(subjectLink('family', 'fam_1')).toBe('/learn?family=fam_1');
    expect(subjectLink('mutation', 'mut_1')).toBe('/drift');
    expect(subjectLink('user', 'usr_1')).toBeNull();
  });

  it('merges seen actions into the known list without duplicates, sorted', () => {
    const options = actionOptions(['zzz.custom', 'auth.login']);
    expect(options).toContain('zzz.custom');
    expect(options.filter((option) => option === 'auth.login')).toHaveLength(1);
    expect([...options]).toEqual([...options].sort());
    expect(options.length).toBe(KNOWN_AUDIT_ACTIONS.length + 1);
  });
});

describe('role matrix', () => {
  it('keeps the human decisions with reviewers and admins only', () => {
    for (const action of ['promote', 'reject', 'rollback', 'approve_mutation'] as const) {
      expect(rolesFor(action)).toEqual(['reviewer', 'admin']);
    }
    expect(can('operator', 'promote')).toBe(false);
    expect(can('viewer', 'promote')).toBe(false);
  });

  it('reserves settings and demo reset for admins', () => {
    expect(rolesFor('manage_settings')).toEqual(['admin']);
    expect(rolesFor('reset_demo')).toEqual(['admin']);
  });

  it('gives viewers read access only, and every higher role everything below it', () => {
    const viewerActions = ACTIONS.filter((action) => can('viewer', action));
    expect(viewerActions).toEqual(['read', 'view_audit']);
    for (const action of ACTIONS) {
      if (can('operator', action)) expect(can('reviewer', action)).toBe(true);
      if (can('reviewer', action)) expect(can('admin', action)).toBe(true);
    }
  });

  it('handles a missing role', () => {
    expect(can(null, 'read')).toBe(false);
    expect(ROLES).toHaveLength(4);
  });
});

const evaluation = (patch: Partial<SecurityEvaluationDto>): SecurityEvaluationDto => ({
  input: 'x',
  parsed: { ok: true },
  allowlist: { ok: true, normalized: 'build --workspace packages/security' },
  permission: { allowed: true, rule: 'command_granted', reason: 'permitted' },
  verdict: 'would_run',
  executed: false,
  explanation: '',
  ...patch,
});

describe('command safety staging', () => {
  it('shows a valid call passing every stage', () => {
    const stages = stagesOf(evaluation({}));
    expect(stages.map((stage) => stage.state)).toEqual(['pass', 'pass', 'pass']);
    expect(stages.some((stage) => stage.blockedHere)).toBe(false);
    expect(stages[1]?.reason).toContain('Normalised to');
  });

  it('stops at parsing and never reaches the later stages', () => {
    const stages = stagesOf(
      evaluation({
        parsed: { ok: false, rule: 'shell_metacharacters', reason: 'Shell control characters' },
        allowlist: { ok: false, rule: 'shell_metacharacters', reason: 'Shell control characters' },
        permission: null,
        verdict: 'blocked',
      }),
    );
    expect(stages.map((stage) => stage.state)).toEqual(['fail', 'skipped', 'skipped']);
    expect(stages[0]?.blockedHere).toBe(true);
    expect(stages[0]?.rule).toBe('shell_metacharacters');
  });

  it('marks the first failing stage as the blocker but keeps later results', () => {
    const stages = stagesOf(
      evaluation({
        allowlist: {
          ok: false,
          rule: 'program_not_allowed',
          reason: 'Program "rm" is not on the allowlist',
          destructive: true,
        },
        permission: {
          allowed: false,
          rule: 'command_not_granted',
          reason: 'Program "rm" is not granted',
        },
        verdict: 'blocked',
      }),
    );
    expect(stages.map((stage) => stage.state)).toEqual(['pass', 'fail', 'fail']);
    expect(stages.map((stage) => stage.blockedHere)).toEqual([false, true, false]);
  });

  it('offers presets for each class of unsafe input plus valid calls', () => {
    const kinds = new Set(PRESETS.map((preset) => preset.kind));
    expect(kinds).toEqual(new Set(['valid', 'destructive', 'metacharacters', 'traversal', 'flag']));
    expect(PRESETS.every((preset) => preset.command.length > 0)).toBe(true);
  });
});
