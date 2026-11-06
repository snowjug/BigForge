import type { SettingsDto } from '@bigforge/schemas';

/**
 * Settings form model and validation. The server validates again (packages/schemas + routes/ops.ts);
 * these rules mirror its limits so mistakes are caught before a round trip.
 * Ratios (agreement, thresholds) are edited as percentages and stored as 0..1.
 */

export interface SettingsForm {
  gate: {
    minShadowRuns: string;
    minDistinctVariants: string;
    maxSafetyViolations: string;
    minAgreementPct: string;
    minReplayAgreementPct: string;
  };
  drift: {
    minSamples: string;
    dropThresholdPct: string;
    floorPct: string;
    watchBelowPct: string;
  };
  economics: {
    reviewMinutes: string;
    reviewerUsdPerHour: string;
    projectedExecutions: string;
    includeLearningInInvestment: boolean;
  };
}

export type FieldKey =
  | 'gate.minShadowRuns'
  | 'gate.minDistinctVariants'
  | 'gate.maxSafetyViolations'
  | 'gate.minAgreementPct'
  | 'gate.minReplayAgreementPct'
  | 'drift.minSamples'
  | 'drift.dropThresholdPct'
  | 'drift.floorPct'
  | 'drift.watchBelowPct'
  | 'economics.reviewMinutes'
  | 'economics.reviewerUsdPerHour'
  | 'economics.projectedExecutions';
export type FieldErrors = Partial<Record<FieldKey, string>>;

interface Rule {
  label: string;
  kind: 'int' | 'number' | 'pct';
  min: number;
  max?: number;
}

export const RULES: Record<FieldKey, Rule> = {
  'gate.minShadowRuns': { label: 'Minimum shadow runs', kind: 'int', min: 1 },
  'gate.minDistinctVariants': { label: 'Minimum distinct variants', kind: 'int', min: 1 },
  'gate.maxSafetyViolations': { label: 'Maximum safety violations', kind: 'int', min: 0 },
  'gate.minAgreementPct': { label: 'Minimum shadow agreement', kind: 'pct', min: 0, max: 100 },
  'gate.minReplayAgreementPct': {
    label: 'Minimum replay agreement',
    kind: 'pct',
    min: 0,
    max: 100,
  },
  'drift.minSamples': { label: 'Minimum canary samples', kind: 'int', min: 1, max: 200 },
  'drift.dropThresholdPct': {
    label: 'Agreement drop that confirms drift',
    kind: 'pct',
    min: 0,
    max: 100,
  },
  'drift.floorPct': { label: 'Agreement floor', kind: 'pct', min: 0, max: 100 },
  'drift.watchBelowPct': { label: 'Watch below confidence', kind: 'pct', min: 0, max: 100 },
  'economics.reviewMinutes': { label: 'Review time', kind: 'number', min: 0, max: 600 },
  'economics.reviewerUsdPerHour': { label: 'Reviewer rate', kind: 'number', min: 0, max: 1000 },
  'economics.projectedExecutions': {
    label: 'Projected executions',
    kind: 'int',
    min: 1,
    max: 1_000_000,
  },
};

/** Percent to a 0..1 ratio, free of float noise (95.5 -> 0.955). */
export const pctToRatio = (pct: number): number => Math.round(pct * 100) / 10_000;

/** A 0..1 ratio to percent text with at most two decimals (0.955 -> "95.5"). */
export const ratioToPctText = (ratio: number): string => String(Math.round(ratio * 10_000) / 100);

export function toForm(settings: SettingsDto): SettingsForm {
  const { gate, drift, economics } = settings;
  return {
    gate: {
      minShadowRuns: String(gate.minShadowRuns),
      minDistinctVariants: String(gate.minDistinctVariants),
      maxSafetyViolations: String(gate.maxSafetyViolations),
      minAgreementPct: ratioToPctText(gate.minAgreement),
      minReplayAgreementPct: ratioToPctText(gate.minReplayAgreement),
    },
    drift: {
      minSamples: String(drift.minSamples),
      dropThresholdPct: ratioToPctText(drift.dropThreshold),
      floorPct: ratioToPctText(drift.floor),
      watchBelowPct: ratioToPctText(drift.watchBelow),
    },
    economics: {
      reviewMinutes: String(economics.reviewMinutes),
      reviewerUsdPerHour: String(economics.reviewerUsdPerHour),
      projectedExecutions: String(economics.projectedExecutions),
      includeLearningInInvestment: economics.includeLearningInInvestment,
    },
  };
}

function fieldError(rule: Rule, text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === '') return `${rule.label} is required.`;
  const value = Number(trimmed);
  if (!Number.isFinite(value)) return `${rule.label} must be a number.`;
  const unit = rule.kind === 'pct' ? ' percent' : '';
  const range =
    rule.max === undefined ? `${rule.min} or more` : `${rule.min} to ${rule.max}${unit}`;
  if (rule.kind === 'int' && !Number.isInteger(value)) {
    return `${rule.label} must be a whole number, ${range}.`;
  }
  if (value < rule.min || (rule.max !== undefined && value > rule.max)) {
    return `${rule.label} must be ${range}.`;
  }
  return null;
}

export type Validation = { ok: true; value: SettingsDto } | { ok: false; errors: FieldErrors };

export function validateForm(form: SettingsForm): Validation {
  const text: Record<FieldKey, string> = {
    'gate.minShadowRuns': form.gate.minShadowRuns,
    'gate.minDistinctVariants': form.gate.minDistinctVariants,
    'gate.maxSafetyViolations': form.gate.maxSafetyViolations,
    'gate.minAgreementPct': form.gate.minAgreementPct,
    'gate.minReplayAgreementPct': form.gate.minReplayAgreementPct,
    'drift.minSamples': form.drift.minSamples,
    'drift.dropThresholdPct': form.drift.dropThresholdPct,
    'drift.floorPct': form.drift.floorPct,
    'drift.watchBelowPct': form.drift.watchBelowPct,
    'economics.reviewMinutes': form.economics.reviewMinutes,
    'economics.reviewerUsdPerHour': form.economics.reviewerUsdPerHour,
    'economics.projectedExecutions': form.economics.projectedExecutions,
  };
  const errors: FieldErrors = {};
  for (const key of Object.keys(RULES) as FieldKey[]) {
    const message = fieldError(RULES[key], text[key]);
    if (message) errors[key] = message;
  }
  if (Object.keys(errors).length > 0) return { ok: false, errors };

  const n = (key: FieldKey): number => Number(text[key].trim());
  const ratio = (key: FieldKey): number => pctToRatio(n(key));
  return {
    ok: true,
    value: {
      gate: {
        minShadowRuns: n('gate.minShadowRuns'),
        minDistinctVariants: n('gate.minDistinctVariants'),
        maxSafetyViolations: n('gate.maxSafetyViolations'),
        minAgreement: ratio('gate.minAgreementPct'),
        minReplayAgreement: ratio('gate.minReplayAgreementPct'),
      },
      drift: {
        minSamples: n('drift.minSamples'),
        dropThreshold: ratio('drift.dropThresholdPct'),
        floor: ratio('drift.floorPct'),
        watchBelow: ratio('drift.watchBelowPct'),
      },
      economics: {
        reviewMinutes: n('economics.reviewMinutes'),
        reviewerUsdPerHour: n('economics.reviewerUsdPerHour'),
        projectedExecutions: n('economics.projectedExecutions'),
        includeLearningInInvestment: form.economics.includeLearningInInvestment,
      },
    },
  };
}

const SERVER_FIELD: Record<string, FieldKey> = {
  'gate.minShadowRuns': 'gate.minShadowRuns',
  'gate.minDistinctVariants': 'gate.minDistinctVariants',
  'gate.maxSafetyViolations': 'gate.maxSafetyViolations',
  'gate.minAgreement': 'gate.minAgreementPct',
  'gate.minReplayAgreement': 'gate.minReplayAgreementPct',
  'drift.minSamples': 'drift.minSamples',
  'drift.dropThreshold': 'drift.dropThresholdPct',
  'drift.floor': 'drift.floorPct',
  'drift.watchBelow': 'drift.watchBelowPct',
  'economics.reviewMinutes': 'economics.reviewMinutes',
  'economics.reviewerUsdPerHour': 'economics.reviewerUsdPerHour',
  'economics.projectedExecutions': 'economics.projectedExecutions',
};

/** Maps the server's `details: [{ path, message }]` (a 400 from PUT /api/settings) onto form fields. */
export function serverFieldErrors(details: unknown): FieldErrors {
  const errors: FieldErrors = {};
  if (!Array.isArray(details)) return errors;
  for (const entry of details as unknown[]) {
    if (typeof entry !== 'object' || entry === null) continue;
    const { path, message } = entry as { path?: unknown; message?: unknown };
    if (typeof path !== 'string' || typeof message !== 'string') continue;
    const key = SERVER_FIELD[path];
    if (key && !errors[key]) errors[key] = message;
  }
  return errors;
}
