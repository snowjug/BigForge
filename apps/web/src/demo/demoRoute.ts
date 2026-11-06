import type { DemoContext, DemoStepDto } from '@bigforge/schemas';
import {
  driftPath,
  economicsPath,
  learnPath,
  reflexPath,
  reflexesPath,
  runPath,
  safeNext,
  shadowPath,
  tracePath,
  tracesPath,
} from '../routes';

/** Scenario ids of the synthetic lab that the demo director stores in `DemoContext.taskIds`. */
const FIRST_TASK_SCENARIO = 'L1';
const HELD_OUT_SCENARIO = 'K1';

/** Steps of "The killer moment": they follow the held-out task and its Reflex run. */
const KILLER_STEPS: ReadonlySet<string> = new Set([
  'new_task',
  'recognized',
  'known_steps',
  'boundary',
  'firewall',
  'ai_resolves',
  'continues',
  'verified',
  'comparison',
]);

/**
 * Where a demo step should be shown: the server supplies the page (`step.route`), and the demo
 * context supplies the ids, which this maps onto the query convention in routes.ts. Ids that do not
 * exist yet are omitted, so a step always lands on a valid page.
 */
export function demoRoute(step: Pick<DemoStepDto, 'id' | 'route'>, context: DemoContext): string {
  const version = context.reflexVersionId;
  switch (step.route) {
    case '/run':
      return KILLER_STEPS.has(step.id)
        ? runPath({ task: context.taskIds[HELD_OUT_SCENARIO], run: context.killerRunId })
        : runPath({
            task: context.taskIds[FIRST_TASK_SCENARIO],
            run: step.id === 'baseline_handles' ? context.firstRunId : null,
          });
    case '/traces':
      return context.firstRunId ? tracePath(context.firstRunId) : tracesPath();
    case '/learn':
      return learnPath({ family: context.familyId });
    case '/reflexes':
      return version ? reflexPath(version) : reflexesPath();
    case '/shadow':
      return shadowPath({ version });
    case '/drift':
      return driftPath({ version });
    case '/economics':
      return economicsPath();
    default:
      return safeNext(step.route) ?? '/';
  }
}
