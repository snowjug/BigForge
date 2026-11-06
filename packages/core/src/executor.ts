import type { Provider } from '@bigforge/providers';
import {
  type BoundaryResolution,
  type EvidenceChunk,
  type JsonValue,
  type ReflexSpec,
  ReflexSpec as ReflexSpecSchema,
  type ReflexStep,
} from '@bigforge/schemas';
import { resolveBoundary } from './boundary';
import {
  type EvalContext,
  describeCondition,
  evalCondition,
  resolveOperand,
  resolveRef,
} from './conditions';
import type { TokenFirewall } from './firewall';
import type { IdGenerator } from './ids';
import {
  EvidencePool,
  type OperatorLibrary,
  type OperatorResult,
  permissionSetFromSpec,
  substituteSelf,
} from './operators';
import type { TraceRecorder } from './recorder';
import { type Sandbox, SandboxViolation } from './sandbox';
import { InstrumentedTools } from './tools';

export interface ExecuteOptions {
  spec: ReflexSpec;
  library: OperatorLibrary;
  /** Any sandbox over the working directory; the Reflex always runs under its own declared permissions. */
  sandbox: Sandbox;
  recorder: TraceRecorder;
  provider: Provider | null;
  firewall: TokenFirewall;
  ids: IdGenerator;
  boundaryPolicyId: string;
  inputs: Record<string, JsonValue>;
  env: Record<string, JsonValue>;
  /** False in dry-run modes where a model call must not be made. */
  allowBoundary: boolean;
  /** Wall-clock deadline for the whole execution. */
  now?: () => number;
}

export interface StepResult {
  stepId: string;
  operator: string;
  status: 'ok' | 'escalated' | 'stopped' | 'skipped';
  executor: 'local' | 'model';
  summary: string;
  confidence?: number;
}

export interface ExecutionResult {
  status: 'completed' | 'stopped';
  stopReason: string | null;
  stopStepId: string | null;
  steps: StepResult[];
  outputs: Record<string, unknown>;
  ctx: EvalContext;
  boundaries: BoundaryResolution[];
  evidence: EvidenceChunk[];
}

export function topologicalOrder(steps: ReflexStep[]): ReflexStep[] {
  const byId = new Map(steps.map((s) => [s.id, s]));
  if (byId.size !== steps.length) throw new Error('Duplicate step ids');
  const placed = new Set<string>();
  const out: ReflexStep[] = [];
  while (out.length < steps.length) {
    const next = steps.find((s) => !placed.has(s.id) && s.dependsOn.every((d) => placed.has(d)));
    if (!next) throw new Error('Step graph has a cycle or a missing dependency');
    for (const d of next.dependsOn) if (!byId.has(d)) throw new Error(`Unknown dependency: ${d}`);
    placed.add(next.id);
    out.push(next);
  }
  return out;
}

/**
 * Executes a Reflex: a validated DAG of deterministic operators under declared least-privilege
 * permissions. Known steps never call a model. A step may cross its uncertainty boundary only
 * through the Token Firewall. Any failed precondition, violation or unexpected result stops the
 * Reflex so control returns to the ordinary agent (it never improvises).
 */
export async function executeReflex(opts: ExecuteOptions): Promise<ExecutionResult> {
  const { recorder } = opts;
  const now = opts.now ?? (() => Date.now());
  const ctx: EvalContext = { inputs: opts.inputs, env: opts.env, steps: {} };
  const pool = new EvidencePool();
  const boundaries: BoundaryResolution[] = [];
  const results: StepResult[] = [];
  const priorCallHashes: string[] = [];

  const stop = (reason: string, stepId: string | null): ExecutionResult => {
    recorder.note('warn', `Reflex stopped: ${reason}`);
    return {
      status: 'stopped',
      stopReason: reason,
      stopStepId: stepId,
      steps: results,
      outputs: {},
      ctx,
      boundaries,
      evidence: pool.all(),
    };
  };

  const parsed = ReflexSpecSchema.safeParse(opts.spec);
  if (!parsed.success) return stop('invalid_spec: the Reflex does not match its schema', null);
  const spec = parsed.data;

  let ordered: ReflexStep[];
  try {
    ordered = topologicalOrder(spec.steps);
  } catch (err) {
    return stop(`invalid_graph: ${err instanceof Error ? err.message : 'unknown'}`, null);
  }
  if (ordered.length > spec.permissions.limits.maxSteps) return stop('too_many_steps', null);

  for (const cond of spec.preconditions) {
    if (!evalCondition(cond, ctx))
      return stop(`precondition_failed: ${describeCondition(cond)}`, null);
  }

  const sandbox = opts.sandbox.derive(permissionSetFromSpec(spec.permissions), (r) =>
    recorder.safety(r),
  );
  const tools = new InstrumentedTools(sandbox, recorder);
  const opCtx = { tools, sandbox, evidence: pool, inputs: opts.inputs, env: opts.env };
  const deadline = now() + spec.permissions.limits.timeoutS * 1000;

  for (const step of ordered) {
    if (now() > deadline) return stop('timeout: the Reflex exceeded its time limit', step.id);
    const operatorId = `${step.operator.id}@${step.operator.version}`;
    const op = opts.library.get(step.operator.id, step.operator.version);
    if (!op) return stop(`unknown_operator: ${operatorId}`, step.id);

    const token = recorder.beginStep();
    let result: OperatorResult;
    try {
      const args: Record<string, unknown> = {};
      for (const [name, binding] of Object.entries(step.args))
        args[name] = resolveOperand(ctx, binding);
      result = await op.run(opCtx, args);
    } catch (err) {
      const reason =
        err instanceof SandboxViolation
          ? `sandbox_violation: ${err.rule}`
          : `operator_error: ${err instanceof Error ? err.message.slice(0, 200) : 'unknown'}`;
      recorder.endStep(token, {
        stepId: step.id,
        operator: operatorId,
        status: 'stopped',
        executor: 'local',
        summary: reason,
      });
      results.push({
        stepId: step.id,
        operator: operatorId,
        status: 'stopped',
        executor: 'local',
        summary: reason,
      });
      return stop(reason, step.id);
    }

    ctx.steps[step.id] = {
      output: result.output,
      ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
    };

    const stopCondition = step.stopWhen.find((c) => evalCondition(c, ctx));
    if (stopCondition) {
      const reason = `stop_condition: ${describeCondition(stopCondition)}`;
      recorder.endStep(token, {
        stepId: step.id,
        operator: operatorId,
        status: 'stopped',
        executor: 'local',
        summary: `${result.summary}; ${reason}`,
      });
      results.push({
        stepId: step.id,
        operator: operatorId,
        status: 'stopped',
        executor: 'local',
        summary: result.summary,
      });
      return stop(reason, step.id);
    }

    const escalate = step.escalateWhen.find((c) => evalCondition(c, ctx));
    if (!escalate) {
      recorder.endStep(token, {
        stepId: step.id,
        operator: operatorId,
        status: 'ok',
        executor: 'local',
        ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
        summary: result.summary,
      });
      results.push({
        stepId: step.id,
        operator: operatorId,
        status: 'ok',
        executor: 'local',
        summary: result.summary,
        ...(result.confidence !== undefined ? { confidence: result.confidence } : {}),
      });
      continue;
    }

    // Uncertainty boundary.
    const reason = `${describeCondition(escalate)} (${result.summary})`;
    if (!step.boundary || !opts.allowBoundary) {
      const why = !step.boundary
        ? 'no uncertainty boundary is defined'
        : 'model calls are disabled in this mode';
      recorder.endStep(token, {
        stepId: step.id,
        operator: operatorId,
        status: 'stopped',
        executor: 'local',
        summary: `${result.summary}; ${why}`,
      });
      results.push({
        stepId: step.id,
        operator: operatorId,
        status: 'stopped',
        executor: 'local',
        summary: result.summary,
      });
      return stop(`needs_escalation: ${why}`, step.id);
    }
    const boundary = substituteSelf(step.boundary, step.id);
    const rawOptions = resolveRef(ctx, boundary.optionsFrom);
    const optionList = Array.isArray(rawOptions)
      ? (rawOptions as { id: string; label: string; detail: string; payload: unknown }[])
      : [];
    const { resolution, callHash } = await resolveBoundary(
      {
        provider: opts.provider,
        firewall: opts.firewall,
        recorder,
        ids: opts.ids,
        policyId: opts.boundaryPolicyId,
      },
      {
        stepId: step.id,
        boundary,
        question: boundary.question,
        reason,
        whyNotReflex: `${op.title} is not confident enough to decide alone: ${result.summary}`,
        options: optionList.map((o) => ({ id: o.id, label: o.label, detail: o.detail })),
        pool: pool.all(),
        callsMade: boundaries.filter((b) => b.call !== null).length,
        priorCallHashes,
      },
    );
    boundaries.push(resolution);
    priorCallHashes.push(callHash);

    if (resolution.outcome !== 'resolved' || !resolution.answer) {
      const why = `boundary_${resolution.outcome}`;
      recorder.endStep(token, {
        stepId: step.id,
        operator: operatorId,
        status: 'stopped',
        executor: 'model',
        summary: `${result.summary}; ${why}`,
      });
      results.push({
        stepId: step.id,
        operator: operatorId,
        status: 'stopped',
        executor: 'model',
        summary: why,
      });
      return stop(why, step.id);
    }
    const chosen = optionList.find((o) => o.id === resolution.answer?.choiceId);
    if (!chosen) return stop('boundary_invalid_output', step.id);
    const output = {
      ...(ctx.steps[step.id]?.output as Record<string, unknown>),
      [boundary.resolveInto]: chosen.payload,
      resolved_by: 'model',
    };
    ctx.steps[step.id] = { output, confidence: resolution.answer.confidence };
    const summary = `${op.title}: model chose "${chosen.label}" (${resolution.answer.rationale})`;
    recorder.decision({
      intent: op.intent,
      by: 'model',
      operator: operatorId,
      confidence: resolution.answer.confidence,
      output: { choiceId: chosen.id },
    });
    recorder.endStep(token, {
      stepId: step.id,
      operator: operatorId,
      status: 'escalated',
      executor: 'model',
      confidence: resolution.answer.confidence,
      summary,
    });
    results.push({
      stepId: step.id,
      operator: operatorId,
      status: 'escalated',
      executor: 'model',
      summary,
      confidence: resolution.answer.confidence,
    });
  }

  const outputs = Object.fromEntries(
    Object.entries(spec.outputs).map(([k, b]) => [k, resolveOperand(ctx, b)]),
  );
  return {
    status: 'completed',
    stopReason: null,
    stopStepId: null,
    steps: results,
    outputs,
    ctx,
    boundaries,
    evidence: pool.all(),
  };
}
