import type { SettingsDto } from '@bigforge/schemas';
import { describe, expect, it } from 'vitest';
import {
  pctToRatio,
  ratioToPctText,
  serverFieldErrors,
  toForm,
  validateForm,
} from '../src/pages/settings/validate';

const defaults: SettingsDto = {
  gate: {
    minShadowRuns: 10,
    minDistinctVariants: 3,
    maxSafetyViolations: 0,
    minAgreement: 0.95,
    minReplayAgreement: 1,
  },
  drift: { minSamples: 8, dropThreshold: 0.1, floor: 0.9, watchBelow: 0.85 },
  economics: {
    reviewMinutes: 10,
    reviewerUsdPerHour: 75,
    projectedExecutions: 200,
    includeLearningInInvestment: false,
  },
};

describe('settings form', () => {
  it('round-trips the server settings without float noise', () => {
    const result = validateForm(toForm(defaults));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(defaults);
  });

  it('converts percentages exactly', () => {
    expect(pctToRatio(95.5)).toBe(0.955);
    expect(pctToRatio(85)).toBe(0.85);
    expect(pctToRatio(33.33)).toBe(0.3333);
    expect(ratioToPctText(0.955)).toBe('95.5');
    expect(ratioToPctText(1)).toBe('100');
    expect(ratioToPctText(0.1)).toBe('10');
  });

  it('rejects empty, non-numeric, fractional and out-of-range values with field messages', () => {
    const form = toForm(defaults);
    form.gate.minShadowRuns = '';
    form.gate.minDistinctVariants = '2.5';
    form.gate.minAgreementPct = '101';
    form.drift.minSamples = '0';
    form.drift.floorPct = 'abc';
    form.economics.projectedExecutions = '2000000';
    const result = validateForm(form);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors['gate.minShadowRuns']).toContain('required');
      expect(result.errors['gate.minDistinctVariants']).toContain('whole number');
      expect(result.errors['gate.minAgreementPct']).toContain('0 to 100 percent');
      expect(result.errors['drift.minSamples']).toContain('1 to 200');
      expect(result.errors['drift.floorPct']).toContain('number');
      expect(result.errors['economics.projectedExecutions']).toContain('1 to 1000000');
    }
  });

  it('accepts the boundaries the server accepts', () => {
    const form = toForm(defaults);
    form.gate.maxSafetyViolations = '0';
    form.gate.minAgreementPct = '0';
    form.drift.minSamples = '200';
    form.economics.reviewMinutes = '600';
    form.economics.reviewerUsdPerHour = '0';
    expect(validateForm(form).ok).toBe(true);
  });
});

describe('serverFieldErrors', () => {
  it('maps zod issues from a 400 onto form fields', () => {
    const errors = serverFieldErrors([
      { path: 'gate.minAgreement', message: 'Too big' },
      { path: 'drift.minSamples', message: 'Too small' },
      { path: 'unknown.field', message: 'ignored' },
    ]);
    expect(errors).toEqual({
      'gate.minAgreementPct': 'Too big',
      'drift.minSamples': 'Too small',
    });
  });

  it('ignores anything that is not an issue list', () => {
    expect(serverFieldErrors(undefined)).toEqual({});
    expect(serverFieldErrors({ path: 'x' })).toEqual({});
    expect(serverFieldErrors([null, 4, { path: 1 }])).toEqual({});
  });
});
