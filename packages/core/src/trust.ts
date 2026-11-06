import type { DriftVerdict, TrustWindow } from '@bigforge/schemas';

export const TRUST_WINDOW_SIZE = 12;

/** Trust from the most recent `size` comparisons (shadow, canary and live verification results). */
export function trustFromHistory(results: boolean[], size = TRUST_WINDOW_SIZE): TrustWindow {
  const window = results.slice(-size);
  const n = window.length;
  const successes = window.filter(Boolean).length;
  const confidence = (successes + 1) / (n + 2);
  if (n === 0) return { confidence, successes, n, interval: { low: 0, high: 1 } };
  const z = 1.645;
  const p = successes / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  return {
    confidence,
    successes,
    n,
    interval: { low: Math.max(0, centre - half), high: Math.min(1, centre + half) },
  };
}

export interface DriftConfig {
  minSamples: number;
  /** Confirm drift when agreement fell by at least this much versus history... */
  dropThreshold: number;
  /** ...and is below this absolute floor. */
  floor: number;
  /** Below this confidence an active Reflex goes on watch. */
  watchBelow: number;
}

/** Example thresholds. Configurable; not validated recommendations. */
export const DEFAULT_DRIFT_CONFIG: DriftConfig = {
  minSamples: 8,
  dropThreshold: 0.1,
  floor: 0.9,
  watchBelow: 0.85,
};

export function detectDrift(
  historic: { agree: number; n: number },
  current: { agree: number; n: number },
  cfg: DriftConfig = DEFAULT_DRIFT_CONFIG,
): DriftVerdict {
  const h = historic.n === 0 ? 1 : historic.agree / historic.n;
  const c = current.n === 0 ? 1 : current.agree / current.n;
  const drop = h - c;
  const window = trustFromHistory(
    [
      ...Array<boolean>(current.agree).fill(true),
      ...Array<boolean>(current.n - current.agree).fill(false),
    ],
    current.n,
  );
  const reasons: string[] = [];
  let drift = false;
  if (current.n < cfg.minSamples) {
    reasons.push(
      `Only ${current.n} canary samples; at least ${cfg.minSamples} are needed to confirm drift`,
    );
  } else if (drop >= cfg.dropThreshold && c < cfg.floor) {
    drift = true;
    reasons.push(
      `Agreement fell from ${(h * 100).toFixed(0)}% to ${(c * 100).toFixed(0)}% (drop ${(drop * 100).toFixed(0)} points, threshold ${(cfg.dropThreshold * 100).toFixed(0)}); it is below the ${(cfg.floor * 100).toFixed(0)}% floor`,
    );
  } else {
    reasons.push(
      `Agreement ${(c * 100).toFixed(0)}% is within tolerance of history ${(h * 100).toFixed(0)}%`,
    );
  }
  return {
    drift,
    samples: current.n,
    historicAgreement: h,
    currentAgreement: c,
    drop,
    interval: window.interval,
    reasons,
  };
}

/** Cognitive depreciation: confidence decays with the age of the last validation. */
export function depreciationFactor(ageDays: number, halfLifeDays = 90): number {
  return 0.5 ** (Math.max(0, ageDays) / halfLifeDays);
}
