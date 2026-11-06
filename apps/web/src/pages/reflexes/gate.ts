import type { GateCheck, GateResult } from '@bigforge/schemas';

/** Turns the server's gate result into "what is still missing for promotion", in plain words. */

export interface GateGap {
  check: GateCheck;
  /** What would satisfy the check, as an instruction. */
  gap: string;
}

export interface GateSummary {
  eligible: boolean;
  passed: number;
  total: number;
  ratio: number;
  missing: GateGap[];
  headline: string;
}

const firstNumber = (text: string): number | null => {
  const match = /-?\d+(?:\.\d+)?/.exec(text);
  return match ? Number.parseFloat(match[0]) : null;
};

const more = (count: number, noun: string): string =>
  `${count} more ${count === 1 ? noun : `${noun}s`}`;

/** What would satisfy one failing check. Unknown ids fall back to the server's own numbers. */
export function gateGap(check: GateCheck): string {
  const required = firstNumber(check.required);
  const actual = firstNumber(check.actual);
  switch (check.id) {
    case 'replay':
      return /over 0 trace/.test(check.actual)
        ? 'Replay the candidate against the traces it was compiled from.'
        : `Replay agreement is ${check.actual}; every replayed trace must reproduce (${check.required}).`;
    case 'shadow_runs':
      return required !== null && actual !== null && required > actual
        ? `Run ${more(required - actual, 'Shadow Brain scenario')} (${check.actual} of ${required} done).`
        : `Shadow runs: ${check.actual}, required ${check.required}.`;
    case 'variants':
      return required !== null && actual !== null && required > actual
        ? `Shadow-run ${more(required - actual, 'distinct variant')} (${check.actual} of ${required} covered).`
        : `Distinct variants: ${check.actual}, required ${check.required}.`;
    case 'safety':
      return `The Reflex made ${check.actual} unsafe or blocked ${actual === 1 ? 'action' : 'actions'}; it must make ${check.required.replace('at most ', 'no more than ')}. It needs a recompile.`;
    case 'agreement':
      return `Shadow agreement is ${check.actual}; it must be ${check.required}.`;
    default:
      return `${check.label}: ${check.actual} (required ${check.required}).`;
  }
}

export function summariseGate(gate: GateResult): GateSummary {
  const total = gate.checks.length;
  const missing = gate.checks
    .filter((c) => !c.passed)
    .map((check) => ({ check, gap: gateGap(check) }));
  const passed = total - missing.length;
  const headline = gate.eligible
    ? `All ${total} checks passed. A reviewer can promote it.`
    : missing.length === 1
      ? `1 of ${total} checks is still open: ${(missing[0] as GateGap).check.label.toLowerCase()}.`
      : `${missing.length} of ${total} checks are still open.`;
  return {
    eligible: gate.eligible,
    passed,
    total,
    ratio: total > 0 ? passed / total : 0,
    missing,
    headline,
  };
}
