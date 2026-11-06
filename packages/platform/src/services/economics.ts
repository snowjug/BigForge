import { type EconomicsInput, type UsagePoint, computeEconomics } from '@bigforge/core';
import type { EconomicsReport } from '@bigforge/schemas';
import type { TenantStore } from '../db/store';
import type { Platform } from '../platform';
import { usagePoint } from './shared';

export interface EconomicsAssumptions {
  reviewMinutes: number;
  reviewerUsdPerHour: number;
  projectedExecutions: number;
  includeLearningInInvestment: boolean;
}

export const DEFAULT_ECONOMICS_ASSUMPTIONS: EconomicsAssumptions = {
  reviewMinutes: 10,
  reviewerUsdPerHour: 75,
  projectedExecutions: 200,
  includeLearningInInvestment: false,
};

export class EconomicsService {
  private readonly p: Platform;

  constructor(platform: Platform) {
    this.p = platform;
  }

  assumptions(ts: TenantStore): EconomicsAssumptions {
    return ts.getSetting<EconomicsAssumptions>('economics', DEFAULT_ECONOMICS_ASSUMPTIONS);
  }

  compute(
    ts: TenantStore,
    overrides: Partial<
      Pick<EconomicsAssumptions, 'projectedExecutions' | 'includeLearningInInvestment'>
    > = {},
  ): EconomicsReport {
    const a = { ...this.assumptions(ts), ...overrides };
    const ledger = ts.ledger.all(ts.tenantId, { order: 'created_at ASC', max: 5000 });
    const runs = new Map(
      ts.runs
        .all(ts.tenantId, {
          fields: ['id', 'kind', 'status', 'groupId', 'usage', 'exec', 'reflexVersionId'],
          max: 5000,
        })
        .map((r) => [r.id, r]),
    );
    const point = (runId: string | null): UsagePoint | null => {
      const r = runId ? runs.get(runId) : undefined;
      return r ? usagePoint(r) : null;
    };
    const byCategory = (cat: string) => ledger.filter((l) => l.category === cat);
    const points = (cats: string[]) =>
      cats.flatMap((c) =>
        byCategory(c)
          .map((l) => point(l.runId))
          .filter((x): x is UsagePoint => x !== null),
      );

    const learningBaseline = points(['learning_baseline']);
    const shadowReference = points(['shadow_reference', 'comparison_reference']);
    const canaryReference = points(['canary_reference']);
    const baselineSamples = points(['learning_baseline', 'shadow_reference']);

    const reflexRuns: EconomicsInput['reflexRuns'] = [];
    const purposeOf: Record<string, EconomicsInput['reflexRuns'][number]['purpose']> = {
      reflex_shadow: 'shadow',
      reflex_live: 'live',
      reflex_replay: 'replay',
      reflex_canary: 'canary',
    };
    for (const [cat, purpose] of Object.entries(purposeOf)) {
      for (const l of byCategory(cat)) {
        const r = l.runId ? runs.get(l.runId) : undefined;
        if (!r) continue;
        const reference =
          purpose === 'live' && r.groupId
            ? [...runs.values()].find(
                (x) =>
                  x.groupId === r.groupId &&
                  x.id !== r.id &&
                  ledger.some((ll) => ll.runId === x.id && ll.category === 'comparison_reference'),
              )
            : undefined;
        reflexRuns.push({
          usage: usagePoint(r),
          verified: r.status === 'success',
          purpose,
          reference: reference ? usagePoint(reference) : null,
          crr: r.exec?.crr ?? null,
        });
      }
    }

    const versions = ts.versions.all(ts.tenantId, { fields: ['id', 'compileReport'] });
    const compileMs = versions.reduce((n, v) => n + (v.compileReport.compileMs ?? 0), 0);
    const p = this.p.engine.pricing;
    return computeEconomics({
      pricing: { id: p.id, assumedAt: p.assumedAt, source: p.source, note: p.note },
      now: this.p.now(),
      baselineSamples,
      shadowReference,
      canaryReference,
      learningBaseline,
      reflexRuns,
      compileMs,
      replayRuns: byCategory('reflex_replay').length,
      review: { minutes: a.reviewMinutes, usdPerHour: a.reviewerUsdPerHour },
      projectedExecutions: a.projectedExecutions,
      includeLearningInInvestment: a.includeLearningInInvestment,
    });
  }
}
