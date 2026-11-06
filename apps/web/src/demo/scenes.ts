import type { DemoStepDto } from '@bigforge/schemas';

export interface SceneGroup {
  name: string;
  steps: DemoStepDto[];
  /** Number of completed steps in the scene. */
  doneCount: number;
  /** 1-based step numbers. */
  first: number;
  last: number;
}

/** Groups consecutive steps that share a scene name, keeping the server's order. */
export function groupScenes(steps: readonly DemoStepDto[]): SceneGroup[] {
  const groups: SceneGroup[] = [];
  for (const step of steps) {
    const last = groups[groups.length - 1];
    if (last && last.name === step.scene) {
      last.steps.push(step);
      last.last = step.n;
      if (step.done) last.doneCount += 1;
    } else {
      groups.push({
        name: step.scene,
        steps: [step],
        doneCount: step.done ? 1 : 0,
        first: step.n,
        last: step.n,
      });
    }
  }
  return groups;
}

/** Steps before `n` that have not been completed. Performing step `n` runs these first (server behaviour). */
export function pendingBefore(steps: readonly DemoStepDto[], n: number): DemoStepDto[] {
  return steps.filter((step) => step.n < n && !step.done);
}

/** Why the Next button is unavailable for this step, or null when it may proceed. */
export function nextBlockedReason(step: DemoStepDto | undefined): string | null {
  if (!step) return 'The demo has not loaded yet';
  if (step.kind !== 'view' && !step.done) {
    return step.actionLabel
      ? `Do this step first: ${step.actionLabel}`
      : 'Complete this step before moving on';
  }
  return null;
}

/** The step that records the human approval (server: PROMOTE_STEP). */
export const PROMOTE_STEP = 11;

/** Fast-forward stages and the step each one reaches (server: SEED_STAGES). */
export const SEED_STAGE_STEPS = {
  learned: 7,
  validated: 10,
  promoted: 11,
  killer: 20,
  drifted: 24,
  complete: 25,
} as const;

export type SeedStage = keyof typeof SEED_STAGE_STEPS;

/**
 * Why the signed-in role cannot fast-forward to `stage`, or null when it can. Mirrors the server:
 * seeding needs `run_task`, and reaching the promotion step (or beyond) while the promotion is still
 * pending needs a role that may promote, because a human decision is being simulated.
 */
export function seedBlockedReason(
  stage: SeedStage,
  access: { canRun: boolean; canPromote: boolean; promotionDone: boolean },
): string | null {
  if (!access.canRun)
    return 'Fast-forwarding runs tasks, which needs an operator, reviewer or admin.';
  if (SEED_STAGE_STEPS[stage] >= PROMOTE_STEP && !access.promotionDone && !access.canPromote) {
    return 'Needs a reviewer or admin: this stage includes the human promotion.';
  }
  return null;
}
