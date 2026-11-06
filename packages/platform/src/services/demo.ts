import { HELD_OUT_ID, LEARNING_IDS, SHADOW_IDS } from '@bigforge/lab-monorepo';
import type { DemoContext, DemoStateDto, DemoStepDto, DemoStepKind } from '@bigforge/schemas';
import { type Actor, assertCan, badRequest, conflict } from '../actor';
import type { Platform } from '../platform';

interface StepDef {
  id: string;
  title: string;
  narration: string;
  scene: string;
  route: string;
  kind: DemoStepKind;
  actionLabel: string | null;
}

export const DEMO_STEPS: StepDef[] = [
  {
    id: 'failure_enters',
    title: 'A monorepo build failure enters BigForge',
    narration:
      'A synthetic CI failure arrives: eight workspaces, one root cause, several confusing consequences. BigForge captures the task and its CI log.',
    scene: 'Cold start',
    route: '/run',
    kind: 'action',
    actionLabel: 'Send failure to BigForge',
  },
  {
    id: 'baseline_handles',
    title: 'No Reflex exists, so the baseline agent does everything',
    narration:
      'The matcher finds no family. The agent reads the log, checks the graph, inspects files, decides, patches and verifies, calling the model on every turn.',
    scene: 'Cold start',
    route: '/run',
    kind: 'action',
    actionLabel: 'Run the baseline agent',
  },
  {
    id: 'trace_captured',
    title: 'BigForge captures the observable execution trace',
    narration:
      'Every model call, tool call, decision and verification is recorded in a vendor-neutral trace: tokens (synthetic), commands (measured), secrets redacted.',
    scene: 'Cold start',
    route: '/traces',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'variations',
    title: 'Several related task variations are processed',
    narration:
      'Four more failures of the same kind arrive, with different faults and different workspaces. The baseline solves each one.',
    scene: 'Learning',
    route: '/run',
    kind: 'action',
    actionLabel: 'Process four more failures',
  },
  {
    id: 'family_found',
    title: 'BigForge identifies a recurring task family',
    narration:
      'Fingerprints, not prompts, group the tasks. Unrelated tasks seen the same week stay out. The matcher is measured for false matches.',
    scene: 'Learning',
    route: '/learn',
    kind: 'action',
    actionLabel: 'Discover task families',
  },
  {
    id: 'invariants',
    title: 'It extracts invariant and variable execution steps',
    narration:
      'Aligning the traces shows what never changes (conserved) and what varies. Each model decision is replaced only if a deterministic operator reproduces it on every trace.',
    scene: 'Learning',
    route: '/learn',
    kind: 'action',
    actionLabel: 'Align traces and compile',
  },
  {
    id: 'candidate',
    title: 'A candidate Reflex is generated',
    narration:
      'A typed, versioned, constrained procedure: steps, permissions, guards, verification rules. It is a candidate: it cannot run live.',
    scene: 'Learning',
    route: '/reflexes',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'replay',
    title: 'Historical traces are replayed against the candidate',
    narration:
      'The candidate re-executes every recorded task in the sandbox and is compared with what the baseline did then.',
    scene: 'Validation',
    route: '/shadow',
    kind: 'action',
    actionLabel: 'Replay historical traces',
  },
  {
    id: 'shadow',
    title: 'The candidate runs in Shadow Brain mode beside the baseline',
    narration:
      'Twelve new tasks run through both the AI baseline and the candidate. Shadow mode costs tokens before it saves any: that is booked as learning investment.',
    scene: 'Validation',
    route: '/shadow',
    kind: 'action',
    actionLabel: 'Run Shadow Brain',
  },
  {
    id: 'compare',
    title: 'Outcomes, tokens, calls, latency, commands, safety and verification are compared',
    narration:
      'Side by side, with provenance on every figure: synthetic tokens, simulated model latency, measured local time.',
    scene: 'Validation',
    route: '/shadow',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'promote',
    title: 'A human reviewer inspects and promotes the candidate',
    narration:
      'Promotion is never automatic. The server checks the role, the evidence gate and the content hash. Only a reviewer can press the button.',
    scene: 'Validation',
    route: '/reflexes',
    kind: 'human',
    actionLabel: 'Promote Reflex',
  },
  {
    id: 'new_task',
    title: 'A new related task arrives',
    narration: 'A held-out failure: same family, but its repair has two plausible remedies.',
    scene: 'The killer moment',
    route: '/run',
    kind: 'action',
    actionLabel: 'Send the new failure',
  },
  {
    id: 'recognized',
    title: 'BigForge recognizes the family and selects the Reflex',
    narration:
      'All hard gates pass: intent, toolchain, failure type and known error classes. The active Reflex is selected.',
    scene: 'The killer moment',
    route: '/run',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'known_steps',
    title: 'Known workflow steps execute without an AI call',
    narration:
      'Log normalization, root-cause location, workspace mapping, diagnostics: all local, all deterministic, zero model calls.',
    scene: 'The killer moment',
    route: '/run',
    kind: 'action',
    actionLabel: 'Execute through the Reflex',
  },
  {
    id: 'boundary',
    title: 'A deliberately ambiguous condition creates an Uncertainty Boundary',
    narration:
      'Two exports fit the stale name almost equally well. The Reflex knows where its knowledge ends and refuses to guess.',
    scene: 'The killer moment',
    route: '/run',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'firewall',
    title: 'The Token Firewall selects the minimum relevant context',
    narration:
      'Seven questions, one verdict. Of everything the run observed, only the evidence the question needs may leave the building.',
    scene: 'The killer moment',
    route: '/run',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'ai_resolves',
    title: 'The AI resolves only the uncertain decision',
    narration:
      'One bounded call on a smaller model: a choice among listed options, validated before it is accepted.',
    scene: 'The killer moment',
    route: '/run',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'continues',
    title: 'Reflex execution continues',
    narration: 'The answer feeds the next step; the patch, rebuild and test steps run locally.',
    scene: 'The killer moment',
    route: '/run',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'verified',
    title: 'Objective verification confirms the result',
    narration:
      'Success is evidence, not assertion: the failure no longer reproduces, tests pass, only the right files changed, policy holds.',
    scene: 'The killer moment',
    route: '/run',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'comparison',
    title: 'Baseline and BigForge execution are compared',
    narration:
      'The same task, the same verifier: how many calls, how many tokens, how much work stayed local.',
    scene: 'The killer moment',
    route: '/economics',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'env_change',
    title: 'A synthetic environment change is introduced',
    narration:
      'The build tool is updated: forge-ci 1.4.2 to 1.5.0 now builds in parallel. Nothing in the Reflex says it cannot run there.',
    scene: 'Drift',
    route: '/drift',
    kind: 'action',
    actionLabel: 'Update the build tool',
  },
  {
    id: 'canary',
    title: 'The Drift Canary detects disagreement',
    narration:
      'Familiar tasks go through both the Reflex and the AI again. Where they disagree is where the world changed.',
    scene: 'Drift',
    route: '/drift',
    kind: 'action',
    actionLabel: 'Run the Drift Canary',
  },
  {
    id: 'confidence_falls',
    title: 'Reflex confidence falls',
    narration: 'Trust is earned and expires. Recent agreement drops, and so does confidence.',
    scene: 'Drift',
    route: '/drift',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'back_to_shadow',
    title: 'The Reflex automatically returns to Shadow mode',
    narration:
      'No human needed to stop it: it can no longer execute live. It runs beside the baseline until it earns trust again.',
    scene: 'Drift',
    route: '/reflexes',
    kind: 'view',
    actionLabel: null,
  },
  {
    id: 'mutation',
    title: 'A mutation is proposed but not activated',
    narration:
      'Recompiled from old and new traces, it swaps the fragile step for a robust one. It waits, with its evidence, for a human decision.',
    scene: 'Drift',
    route: '/drift',
    kind: 'action',
    actionLabel: 'Propose a mutation',
  },
];

export const DEMO_TOTAL = DEMO_STEPS.length;

const EMPTY_CONTEXT: DemoContext = {
  taskIds: {},
  familyId: null,
  reflexVersionId: null,
  mutatedVersionId: null,
  firstRunId: null,
  killerRunId: null,
  killerReferenceRunId: null,
  driftCheckId: null,
  mutationId: null,
};

export const SEED_STAGES = {
  learned: 7,
  validated: 10,
  promoted: 11,
  killer: 20,
  drifted: 24,
  complete: 25,
} as const;

/** Orchestrates the 25-step guided demo through the same services the regular pages use. */
export class DemoService {
  private readonly p: Platform;
  private activeJobId = new Map<string, string>();

  constructor(platform: Platform) {
    this.p = platform;
  }

  private load(tenantId: string) {
    const ts = this.p.store.forTenant(tenantId);
    const row = ts.getDemoState();
    return {
      ts,
      step: row?.step ?? 1,
      completed: row?.completed ?? [],
      context: {
        ...EMPTY_CONTEXT,
        ...(row?.context as Partial<DemoContext> | undefined),
      },
    };
  }

  state(actor: Actor): DemoStateDto {
    const { step, completed, context } = this.load(actor.tenantId);
    const jobId = this.activeJobId.get(actor.tenantId);
    let activeJob = null;
    if (jobId) {
      const ts = this.p.store.forTenant(actor.tenantId);
      const row = ts.jobs.get(actor.tenantId, jobId);
      if (row && (row.status === 'queued' || row.status === 'running'))
        activeJob = this.p.jobs.toDto(row);
    }
    const steps: DemoStepDto[] = DEMO_STEPS.map((s, i) => ({
      n: i + 1,
      ...s,
      done: completed.includes(i + 1),
    }));
    return { step, total: DEMO_TOTAL, steps, completed, context, activeJob };
  }

  /** Moves the presenter's cursor (Next / Previous / Restart). Does not perform actions. */
  goto(actor: Actor, step: number): DemoStateDto {
    assertCan(actor, 'read');
    if (!Number.isInteger(step) || step < 1 || step > DEMO_TOTAL)
      throw badRequest(`Step must be between 1 and ${DEMO_TOTAL}`);
    const { ts, completed, context } = this.load(actor.tenantId);
    ts.saveDemoState({ step, completed, context: context });
    return this.state(actor);
  }

  /**
   * Performs the real work behind a step (and any earlier steps that have not run yet).
   * Idempotent: completed steps are skipped. The human step uses the caller's own session.
   */
  async perform(
    actor: Actor,
    n: number,
    options: { simulateHuman?: boolean } = {},
  ): Promise<DemoStateDto> {
    assertCan(actor, 'run_task');
    if (!Number.isInteger(n) || n < 1 || n > DEMO_TOTAL)
      throw badRequest(`Step must be between 1 and ${DEMO_TOTAL}`);
    for (let k = 1; k <= n; k += 1) {
      const { completed } = this.load(actor.tenantId);
      if (completed.includes(k)) continue;
      await this.execute(actor, k, options);
    }
    const { ts, completed, context } = this.load(actor.tenantId);
    ts.saveDemoState({
      step: n,
      completed,
      context: context,
    });
    return this.state(actor);
  }

  /** Fast-forwards to a stage using the same code paths (a simulated reviewer performs the human step). */
  async seed(actor: Actor, stage: keyof typeof SEED_STAGES): Promise<DemoStateDto> {
    assertCan(actor, 'run_task');
    return this.perform(actor, SEED_STAGES[stage], { simulateHuman: true });
  }

  private save(
    tenantId: string,
    mutate: (c: DemoContext) => void,
    completeStep: number,
    advanceTo?: number,
  ): void {
    const { ts, completed, context, step } = this.load(tenantId);
    mutate(context);
    const done = completed.includes(completeStep)
      ? completed
      : [...completed, completeStep].sort((a, b) => a - b);
    ts.saveDemoState({
      step: advanceTo ?? Math.max(step, completeStep),
      completed: done,
      context: context,
    });
  }

  private async runJob(
    actor: Actor,
    type: Parameters<Platform['jobs']['enqueue']>[1],
    params: Record<string, unknown>,
  ) {
    const job = this.p.jobs.enqueue(actor, type, params);
    this.activeJobId.set(actor.tenantId, job.id);
    try {
      const done = await this.p.jobs.runNow(actor, job.id);
      if (done.status === 'failed') throw conflict(done.error ?? 'The job failed');
      return done.result;
    } finally {
      this.activeJobId.delete(actor.tenantId);
    }
  }

  private async execute(
    actor: Actor,
    n: number,
    options: { simulateHuman?: boolean },
  ): Promise<void> {
    const { context } = this.load(actor.tenantId);
    const ts = this.p.store.forTenant(actor.tenantId);
    const id = DEMO_STEPS[n - 1]?.id;
    const tasks = this.p.tasks;

    const needVersion = () => {
      if (!context.reflexVersionId) throw conflict('The candidate Reflex does not exist yet');
      return context.reflexVersionId;
    };

    switch (id) {
      case 'failure_enters': {
        const task = await tasks.intake(actor, LEARNING_IDS[0] as string);
        this.save(actor.tenantId, (c) => (c.taskIds[task.scenarioId] = task.id), n);
        return;
      }
      case 'baseline_handles': {
        const taskId = context.taskIds[LEARNING_IDS[0] as string];
        if (!taskId) throw conflict('The first task has not been received');
        const run = await tasks.run(actor, taskId, 'auto');
        this.save(actor.tenantId, (c) => (c.firstRunId = run.primary.id), n);
        return;
      }
      case 'variations': {
        const rest = LEARNING_IDS.slice(1);
        const result = (await this.runJob(actor, 'learn.batch', { scenarioIds: rest })) as {
          taskIds: Record<string, string>;
        };
        this.save(actor.tenantId, (c) => Object.assign(c.taskIds, result.taskIds), n);
        return;
      }
      case 'family_found': {
        // Unrelated tasks seen the same week: observed, fingerprinted, never executed.
        for (const noise of ['N2', 'N5', 'N7']) {
          if (!ts.tasks.all(ts.tenantId, { where: { scenarioId: noise } }).length)
            tasks.intakeNoise(actor, noise);
        }
        const view = await this.p.learning.discoverFamilies(actor);
        const family = view.families[0];
        if (!family) throw conflict('No family met the discovery thresholds');
        this.save(actor.tenantId, (c) => (c.familyId = family.id), n);
        return;
      }
      case 'invariants': {
        if (!context.familyId) throw conflict('No task family has been discovered yet');
        const version = await this.p.learning.compile(actor, context.familyId);
        this.save(actor.tenantId, (c) => (c.reflexVersionId = version.id), n);
        return;
      }
      case 'replay': {
        await this.p.validation.replay(actor, needVersion());
        this.save(actor.tenantId, () => undefined, n);
        return;
      }
      case 'shadow': {
        await this.runJob(actor, 'shadow', {
          versionId: needVersion(),
          scenarioIds: [...SHADOW_IDS],
        });
        this.save(actor.tenantId, () => undefined, n);
        return;
      }
      case 'promote': {
        const versionId = needVersion();
        if (options.simulateHuman) {
          const reviewer = this.p.reviewerActor(actor.tenantId);
          this.p.validation.promote(
            reviewer,
            versionId,
            'Seeded demo approval (simulated reviewer; not a human decision)',
          );
        } else {
          this.p.validation.promote(
            actor,
            versionId,
            'Approved after inspecting the evidence in the guided demo',
          );
        }
        this.save(actor.tenantId, () => undefined, n);
        return;
      }
      case 'new_task': {
        const task = await tasks.intake(actor, HELD_OUT_ID);
        this.save(actor.tenantId, (c) => (c.taskIds[HELD_OUT_ID] = task.id), n);
        return;
      }
      case 'known_steps': {
        const taskId = context.taskIds[HELD_OUT_ID];
        if (!taskId) throw conflict('The new task has not arrived');
        const run = await tasks.run(actor, taskId, 'compare');
        this.save(
          actor.tenantId,
          (c) => {
            c.killerRunId = run.primary.id;
            c.killerReferenceRunId = run.reference?.id ?? null;
          },
          n,
        );
        return;
      }
      case 'env_change': {
        tasks.setEnvironment(actor, '1.5.0');
        this.save(actor.tenantId, () => undefined, n);
        return;
      }
      case 'canary': {
        const result = (await this.runJob(actor, 'canary', { versionId: needVersion() })) as {
          id: string;
        };
        this.save(actor.tenantId, (c) => (c.driftCheckId = result.id), n);
        return;
      }
      case 'mutation': {
        const m = (await this.runJob(actor, 'mutation', { versionId: needVersion() })) as {
          id: string;
          toVersionId: string;
        };
        this.save(
          actor.tenantId,
          (c) => {
            c.mutationId = m.id;
            c.mutatedVersionId = m.toVersionId;
          },
          n,
        );
        return;
      }
      default:
        // View-only steps have no server action: viewing them is what completes them.
        this.save(actor.tenantId, () => undefined, n);
    }
  }
}
