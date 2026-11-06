import type {
  AlignmentColumn,
  AlignmentRow,
  CompileReport,
  PricingConfig,
  StepDecision,
} from '@bigforge/schemas';
import {
  type JsonValue,
  type ReflexSpec,
  type ReflexStep,
  type Trace,
  type ToolCallEvent,
  type DecisionEvent,
} from '@bigforge/schemas';
import { PermissionGuard } from '@bigforge/security';
import type { Clock, IdGenerator } from './ids';
import {
  EvidencePool,
  type OperatorDefinition,
  type OperatorLibrary,
  type OperatorResult,
  type RecordedBehaviour,
  substituteSelf,
} from './operators';
import { TraceRecorder } from './recorder';
import { asText } from './text';
import type { Sandbox } from './sandbox';
import { InstrumentedTools } from './tools';

export const COMPILER_VERSION = 'bigforge.compiler/1.0.0';

export class CompileError extends Error {
  readonly reasons: string[];
  constructor(message: string, reasons: string[] = []) {
    super(message);
    this.name = 'CompileError';
    this.reasons = reasons;
  }
}

export interface PreparedTrace {
  sandbox: Sandbox;
  inputs: Record<string, JsonValue>;
  env: Record<string, JsonValue>;
  dispose: () => Promise<void>;
}

export interface CompileInput {
  traces: Trace[];
  library: OperatorLibrary;
  /** Rebuilds the exact starting state of a trace's task so candidate operators can be tested on it. */
  prepare: (trace: Trace) => Promise<PreparedTrace>;
  familyId: string;
  name: string;
  version?: string;
  rollbackTo?: string | null;
  mutationOf?: { reflexVersion: string; reason: string } | null;
  minTraces?: number;
  minVariants?: number;
  /** Trace kinds accepted as evidence (default: baseline only). Mutations also learn from canary reference runs. */
  allowedRunKinds?: Trace['runKind'][];
  ids: IdGenerator;
  clock: Clock;
  pricing: PricingConfig;
}

interface Behaviour {
  trace: Trace;
  /** keys (turn purposes + decision intents) in first-appearance order */
  order: string[];
  counts: Map<string, number>;
  tokens: Map<string, number>;
  toolCalls: ToolCallEvent[];
  decisions: DecisionEvent[];
  detail: Map<string, string>;
  argValues: Map<string, Map<string, string>>;
}

function behaviourOf(trace: Trace): Behaviour {
  const order: string[] = [];
  const counts = new Map<string, number>();
  const tokens = new Map<string, number>();
  const detail = new Map<string, string>();
  const argValues = new Map<string, Map<string, string>>();
  const toolCalls: ToolCallEvent[] = [];
  const decisions: DecisionEvent[] = [];
  const see = (key: string) => {
    if (!counts.has(key)) order.push(key);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  };
  let current: string | undefined;
  for (const e of trace.events) {
    if (e.kind === 'model_call' && e.purpose) {
      current = e.purpose;
      see(e.purpose);
      tokens.set(
        e.purpose,
        (tokens.get(e.purpose) ?? 0) + e.usage.inputTokens + e.usage.outputTokens,
      );
    } else if (e.kind === 'decision') {
      decisions.push(e);
      see(e.intent);
      detail.set(e.intent, JSON.stringify(e.output).slice(0, 120));
      const out = e.output;
      if (out && typeof out === 'object' && !Array.isArray(out)) {
        const m = argValues.get(e.intent) ?? new Map<string, string>();
        for (const [k, v] of Object.entries(out)) m.set(k, JSON.stringify(v));
        argValues.set(e.intent, m);
      }
    } else if (e.kind === 'tool_call') {
      toolCalls.push(e);
      const key = e.purpose ?? current;
      if (key) {
        const d =
          e.tool === 'run_command'
            ? asText(e.args.command)
            : `${e.tool} ${asText(e.args.path ?? e.args.file)}`;
        detail.set(key, d.slice(0, 120));
        const m = argValues.get(key) ?? new Map<string, string>();
        for (const [k, v] of Object.entries(e.args)) m.set(`${e.tool}.${k}`, JSON.stringify(v));
        argValues.set(key, m);
      }
    }
  }
  return { trace, order, counts, tokens, toolCalls, decisions, detail, argValues };
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function guardTrace(
  traces: Trace[],
  minTraces: number,
  minVariants: number,
  allowedKinds: readonly Trace['runKind'][],
): void {
  const reasons: string[] = [];
  if (traces.length < minTraces)
    reasons.push(
      `Cold-start protection: ${traces.length} trace(s) is fewer than the ${minTraces} required. One lucky run must never become a Reflex.`,
    );
  const variants = new Set(traces.map((t) => t.task.variantKey));
  if (variants.size < minVariants)
    reasons.push(
      `Variation analysis: ${variants.size} distinct variant(s) is fewer than the ${minVariants} required.`,
    );
  for (const t of traces) {
    if (!allowedKinds.includes(t.runKind))
      reasons.push(`Trace ${t.id} is a ${t.runKind} run; compile only from baseline agent traces.`);
    if (t.outcome.status !== 'success')
      reasons.push(
        `Trace ${t.id} did not succeed (${t.outcome.status}); compile only from verified-successful traces.`,
      );
    if (t.verification.status !== 'pass')
      reasons.push(`Trace ${t.id} was not verified; compile only from verified-successful traces.`);
  }
  if (reasons.length) throw new CompileError('Compilation refused', reasons);
}

/**
 * The Reflex Compiler.
 *
 * 1. Aligns the behaviour of several verified-successful baseline traces and measures which
 *    steps are invariant and which are variable.
 * 2. Derive-or-escalate: a model decision becomes a deterministic operator ONLY if an operator
 *    from the typed library reproduces the recorded behaviour on every trace. Operators that
 *    report low confidence keep an uncertainty boundary.
 * 3. Derives least-privilege permissions, stop/escalation guards and declared verification.
 *
 * It composes validated operators; it does not synthesize new code.
 */
export async function compileReflex(
  input: CompileInput,
): Promise<{ spec: ReflexSpec; report: CompileReport }> {
  const { traces, library } = input;
  guardTrace(
    traces,
    input.minTraces ?? 3,
    input.minVariants ?? 2,
    input.allowedRunKinds ?? ['baseline'],
  );
  const n = traces.length;
  const behaviours = traces.map(behaviourOf);

  // ---- alignment ----
  const keys = [...new Set(behaviours.flatMap((b) => b.order))];
  const decisionKeys = new Set(behaviours.flatMap((b) => b.decisions.map((d) => d.intent)));
  const position = new Map<string, number>();
  for (const key of keys) {
    position.set(
      key,
      mean(
        behaviours
          .filter((b) => b.counts.has(key))
          .map((b) => b.order.indexOf(key) / Math.max(1, b.order.length - 1)),
      ),
    );
  }
  const sortedKeys = [...keys].sort(
    (a, b) => (position.get(a) ?? 0) - (position.get(b) ?? 0) || a.localeCompare(b),
  );
  const purposes = new Set(keys);

  // ---- candidate operators ----
  const all = library.all();
  const selectedPool = new Set<OperatorDefinition>(
    all.filter((op) => op.replaces.some((p) => purposes.has(p)) || op.role === 'verification'),
  );
  const provided = () => new Set([...selectedPool].flatMap((op) => op.provides));
  for (let guard = 0; guard < 16; guard += 1) {
    let grew = false;
    for (const op of [...selectedPool]) {
      for (const data of Object.values(op.consumes)) {
        if (data.startsWith('input.') || provided().has(data)) continue;
        const providers = all.filter((o) => o.provides.includes(data));
        if (providers.length === 0)
          throw new CompileError(`No operator provides "${data}" (needed by ${op.id})`);
        for (const p of providers) {
          selectedPool.add(p);
          grew = true;
        }
      }
    }
    if (!grew) break;
  }

  // ---- groups of alternatives per step ----
  const groups = new Map<string, OperatorDefinition[]>();
  for (const op of selectedPool) groups.set(op.stepId, [...(groups.get(op.stepId) ?? []), op]);
  for (const [stepId, alts] of groups) {
    const sig = (o: OperatorDefinition) => [...o.provides].sort().join(',');
    if (new Set(alts.map(sig)).size > 1)
      throw new CompileError(`Alternatives for step "${stepId}" must provide the same data`);
    if (alts.length > 1 && alts.some((o) => o.mutating))
      throw new CompileError(
        `Step "${stepId}" has mutating alternatives; ambiguity cannot be tested safely`,
      );
  }
  const providerStep = (data: string): string | undefined =>
    [...groups.entries()].find(([, alts]) => alts.some((o) => o.provides.includes(data)))?.[0];
  const groupDeps = (stepId: string): Set<string> => {
    const deps = new Set<string>();
    for (const op of groups.get(stepId) ?? []) {
      for (const data of Object.values(op.consumes)) {
        const p = data.startsWith('input.') ? undefined : providerStep(data);
        if (p && p !== stepId) deps.add(p);
      }
    }
    for (const [other, alts] of groups)
      if (alts.some((o) => o.runsBefore?.includes(stepId))) deps.add(`~${other}`);
    return deps;
  };
  const stepMinPos = (stepId: string): number => {
    const covered = (groups.get(stepId) ?? [])
      .flatMap((o) => o.replaces)
      .filter((p) => position.has(p));
    return covered.length
      ? Math.min(...covered.map((p) => position.get(p) ?? 0))
      : stepId === 'snapshot'
        ? -1
        : 2;
  };
  // evaluation order: data dependencies; "runsBefore" constraints are reversed ordering edges
  const evalOrder: string[] = [];
  const remaining = new Set(groups.keys());
  while (remaining.size) {
    const ready = [...remaining]
      .filter((id) =>
        [...groupDeps(id)].every((d) => (d.startsWith('~') ? true : !remaining.has(d))),
      )
      .filter(
        (id) =>
          ![...groups.entries()].some(
            ([other, alts]) =>
              remaining.has(other) && other !== id && alts.some((o) => o.runsBefore?.includes(id)),
          ),
      )
      .sort((a, b) => stepMinPos(a) - stepMinPos(b) || a.localeCompare(b));
    const next = ready[0];
    if (!next) throw new CompileError('The operator data flow has a cycle');
    evalOrder.push(next);
    remaining.delete(next);
  }

  // ---- evaluate candidates on every trace ----
  const prepared: PreparedTrace[] = [];
  const decisions: StepDecision[] = [];
  const chosen = new Map<string, OperatorDefinition>();
  const baselineStepTokens = new Map<string, number>();
  try {
    for (const t of traces) prepared.push(await input.prepare(t));
    const data = prepared.map(() => new Map<string, unknown>());
    const scratch = () =>
      new TraceRecorder({ ids: input.ids, clock: input.clock, pricing: input.pricing });

    for (const stepId of evalOrder) {
      const alts = [...(groups.get(stepId) ?? [])].sort(
        (a, b) => a.cost - b.cost || a.id.localeCompare(b.id),
      );
      const results = new Map<
        string,
        { ok: boolean; detail: string; outputs: (OperatorResult | null)[]; matched: number }
      >();
      for (const op of alts) {
        const outputs: (OperatorResult | null)[] = [];
        let matched = 0;
        let detail = '';
        for (let i = 0; i < n; i += 1) {
          const prep = prepared[i] as PreparedTrace;
          const beh = behaviours[i] as Behaviour;
          const recorder = scratch();
          const ctx = {
            tools: new InstrumentedTools(prep.sandbox, recorder),
            sandbox: prep.sandbox,
            evidence: new EvidencePool(),
            inputs: prep.inputs,
            env: prep.env,
          };
          const args: Record<string, unknown> = {};
          for (const [name, dataName] of Object.entries(op.consumes)) {
            args[name] = dataName.startsWith('input.')
              ? prep.inputs[dataName.slice(6)]
              : data[i]?.get(dataName);
          }
          let produced: OperatorResult | null = null;
          try {
            produced = await op.run(ctx, args);
          } catch (err) {
            if (!detail)
              detail = `failed on ${beh.trace.task.scenarioId}: ${err instanceof Error ? err.message.slice(0, 120) : 'error'}`;
          }
          outputs.push(produced);
          if (produced) {
            const recorded: RecordedBehaviour = {
              purposes: op.replaces.filter((p) => beh.counts.has(p)),
              toolCalls: beh.toolCalls.filter(
                (tc) => tc.purpose !== undefined && op.replaces.includes(tc.purpose),
              ),
              decisions: beh.decisions.filter((d) => op.replaces.includes(d.intent)),
            };
            const verdict = op.agrees
              ? op.agrees(recorded, produced)
              : { ok: true, detail: 'ran successfully' };
            if (verdict.ok) matched += 1;
            else if (!detail) detail = `${beh.trace.task.scenarioId}: ${verdict.detail}`;
          }
        }
        results.set(op.id, {
          ok: matched === n,
          detail: detail || 'consistent on every trace',
          outputs,
          matched,
        });
      }
      const consistent = alts.filter((o) => results.get(o.id)?.ok);
      const winner = consistent[0];
      if (!winner) {
        throw new CompileError(
          `No operator reproduces the baseline for step "${stepId}"`,
          alts.map((o) => `${o.id}: ${results.get(o.id)?.detail ?? ''}`),
        );
      }
      chosen.set(stepId, winner);
      decisions.push({
        stepId,
        chosen: `${winner.id}@${winner.version}`,
        alternatives: alts.map((o) => ({
          operator: `${o.id}@${o.version}`,
          consistent: !!results.get(o.id)?.ok,
          matched: results.get(o.id)?.matched ?? 0,
          of: n,
          detail: results.get(o.id)?.detail ?? '',
        })),
        reason:
          consistent.length > 1
            ? `${consistent.length} operators reproduce the baseline on all ${n} traces; the simplest (${winner.id}) was selected.`
            : alts.length > 1
              ? `Only ${winner.id} reproduces the baseline on all ${n} traces.`
              : `${winner.id} reproduces the baseline on all ${n} traces.`,
      });
      const winnerOutputs = results.get(winner.id)?.outputs ?? [];
      for (let i = 0; i < n; i += 1) {
        const out = winnerOutputs[i]?.output;
        if (out) for (const name of winner.provides) data[i]?.set(name, out[name]);
      }
    }
  } finally {
    await Promise.allSettled(prepared.map((p) => p.dispose()));
  }

  // ---- steps ----
  const stepIds = evalOrder;
  const depsOf = (stepId: string): string[] => {
    const op = chosen.get(stepId) as OperatorDefinition;
    const deps = new Set<string>();
    for (const dataName of Object.values(op.consumes)) {
      if (dataName.startsWith('input.')) continue;
      const p = [...chosen.entries()].find(([, o]) => o.provides.includes(dataName))?.[0];
      if (p) deps.add(p);
    }
    for (const [other, o] of chosen)
      if (other !== stepId && o.runsBefore?.includes(stepId)) deps.add(other);
    return [...deps];
  };
  const orderedIds: string[] = [];
  const left = new Set(stepIds);
  while (left.size) {
    const next = [...left]
      .filter((id) => depsOf(id).every((d) => !left.has(d)))
      .sort((a, b) => stepMinPos(a) - stepMinPos(b) || a.localeCompare(b))[0];
    if (!next) throw new CompileError('The final step graph has a cycle');
    orderedIds.push(next);
    left.delete(next);
  }

  const columnOf = new Map<string, string>();
  const steps: ReflexStep[] = orderedIds.map((stepId) => {
    const op = chosen.get(stepId) as OperatorDefinition;
    const decision = decisions.find((d) => d.stepId === stepId) as StepDecision;
    const covered = op.replaces.filter((p) => purposes.has(p));
    for (const p of covered) columnOf.set(p, `${op.id}@${op.version}`);
    const turnTokens = covered.filter(
      (p) => !decisionKeys.has(p) || behaviours.some((b) => b.tokens.has(p)),
    );
    const baselineTokens = Math.round(
      mean(behaviours.map((b) => turnTokens.reduce((s, p) => s + (b.tokens.get(p) ?? 0), 0))),
    );
    baselineStepTokens.set(stepId, baselineTokens);
    const args: ReflexStep['args'] = {};
    for (const [name, dataName] of Object.entries(op.consumes)) {
      if (dataName.startsWith('input.')) args[name] = { ref: `inputs.${dataName.slice(6)}` };
      else {
        const p = [...chosen.entries()].find(([, o]) => o.provides.includes(dataName))?.[0];
        args[name] = { ref: `steps.${p}.output.${dataName}` };
      }
    }
    const step: ReflexStep = {
      id: stepId,
      title: op.title,
      kind: op.kind,
      operator: { id: op.id, version: op.version },
      args,
      dependsOn: depsOf(stepId),
      escalateWhen: op.escalation
        ? [
            {
              op: 'lt',
              left: { ref: `steps.${stepId}.confidence` },
              right: { const: op.escalation.threshold },
            },
          ]
        : [],
      stopWhen: substituteSelf(op.stopWhen ?? [], stepId),
      ...(op.escalation ? { boundary: substituteSelf(op.escalation.boundary, stepId) } : {}),
      rationale: {
        replaces: covered,
        conservation: covered.length
          ? Math.min(...covered.map((p) => behaviours.filter((b) => b.counts.has(p)).length / n))
          : 1,
        baselineTokens,
        selectedBecause: decision.reason,
        alternatives: decision.alternatives.map((a) => ({
          operator: a.operator,
          consistent: a.consistent,
          matched: a.matched,
          of: a.of,
        })),
      },
    };
    return step;
  });

  // ---- permissions ----
  const read = new Set<string>();
  const write = new Set<string>();
  const commands = new Map<string, Set<string>>();
  for (const op of chosen.values()) {
    op.requires.read.forEach((g) => read.add(g));
    op.requires.write.forEach((g) => write.add(g));
    for (const c of op.requires.commands) {
      const [program, sub] = c.split(' ');
      if (program && sub) commands.set(program, new Set([...(commands.get(program) ?? []), sub]));
    }
  }
  const permissions: ReflexSpec['permissions'] = {
    read: [...read].sort(),
    write: [...write].sort(),
    commands: [...commands.entries()].map(([program, subs]) => ({
      program,
      subcommands: [...subs].sort(),
    })),
    limits: {
      network: false,
      secrets: 'none',
      timeoutS: 120,
      maxOutputBytes: 1_000_000,
      maxSteps: steps.length + 4,
    },
  };
  // Defence in depth: the declared permissions must not grant writes to protected paths.
  const guard = new PermissionGuard({
    read: permissions.read,
    write: permissions.write,
    commands: permissions.commands,
  });
  for (const w of permissions.write) {
    if (!guard.canWrite(w.replace(/\*+/g, 'x')).allowed && /forge\.lock|\.github|^ci\//.test(w)) {
      throw new CompileError(`Operator requested a protected write path: ${w}`);
    }
  }

  // ---- inputs, compatibility, verification, provenance ----
  const inputs: ReflexSpec['inputs'] = {};
  for (const op of chosen.values()) {
    for (const dataName of Object.values(op.consumes)) {
      if (dataName.startsWith('input.')) {
        inputs[dataName.slice(6)] = {
          type: 'path',
          description: 'Repository-relative path of the CI failure log artifact',
          required: true,
        };
      }
    }
  }
  const versions = [...new Set(traces.map((t) => t.environment.toolchain.version))].sort();
  const toolName = traces[0]?.environment.toolchain.name ?? 'unknown';
  const majors = [...new Set(versions.map((v) => Number(v.split('.')[0])))];
  const minVersion = versions[0] ?? '0.0.0';
  const range = `>=${minVersion} <${(majors[majors.length - 1] ?? 0) + 1}.0.0`;

  const outputs: ReflexSpec['outputs'] = {};
  const maybe = (name: string, stepId: string, field: string) => {
    if (chosen.has(stepId)) outputs[name] = { ref: `steps.${stepId}.output.${field}` };
  };
  maybe('root_failure', 'locate', 'root_failure');
  maybe('remedy', 'decide', 'remedy');
  maybe('report', 'report', 'report');
  maybe('verification', 'verify', 'verification');

  const assumptions: string[] = [
    `Toolchain compatibility is inferred as ${toolName} ${range} from observed version(s) ${versions.join(', ')}. Behaviour changes inside that range are not detected at compile time; the Drift Canary monitors them.`,
  ];
  for (const d of decisions) {
    const consistent = d.alternatives.filter((a) => a.consistent);
    if (consistent.length > 1) {
      const op = chosen.get(d.stepId) as OperatorDefinition;
      assumptions.push(
        `Step "${d.stepId}": ${consistent.length} operators fit all ${n} traces (${consistent.map((a) => a.operator).join(', ')}). Chose the simpler ${op.id}. ${op.description}`,
      );
    }
    const op = chosen.get(d.stepId) as OperatorDefinition;
    if (op.escalation)
      assumptions.push(
        `Step "${d.stepId}" decides locally only when its confidence is at least ${op.escalation.threshold}; otherwise it crosses its uncertainty boundary.`,
      );
  }

  // ---- report ----
  const excluded: CompileReport['excludedBehaviours'] = [];
  const uncovered: string[] = [];
  for (const key of sortedKeys) {
    if (columnOf.has(key)) continue;
    const calls = behaviours.flatMap((b) => b.toolCalls.filter((t) => t.purpose === key));
    const presentIn = behaviours.filter((b) => b.counts.has(key)).length;
    if (calls.length > 0 && calls.every((c) => c.status === 'blocked')) {
      excluded.push({
        purpose: key,
        occurrences: presentIn,
        reason:
          'Every tool call was blocked by the safety policy; unsafe behaviour is never compiled into a Reflex.',
      });
    } else if (presentIn / n >= 0.6) {
      throw new CompileError(
        `The invariant behaviour "${key}" (${presentIn}/${n} traces) is not covered by any operator`,
      );
    } else if (!decisionKeys.has(key) || calls.length > 0) {
      uncovered.push(key);
      excluded.push({
        purpose: key,
        occurrences: presentIn,
        reason: `Appears in only ${presentIn} of ${n} traces and no operator covers it; treated as incidental.`,
      });
    }
  }

  const columns: AlignmentColumn[] = sortedKeys.map((key) => {
    const presentBehaviours = behaviours.filter((b) => b.counts.has(key));
    const conservation = presentBehaviours.length / n;
    const slotNames = new Set<string>();
    const argMaps = presentBehaviours
      .map((b) => b.argValues.get(key))
      .filter((m): m is Map<string, string> => !!m);
    for (const name of new Set(argMaps.flatMap((m) => [...m.keys()]))) {
      const vals = new Set(argMaps.map((m) => m.get(name)));
      if (vals.size > 1) slotNames.add(name);
    }
    return {
      key,
      kind:
        decisionKeys.has(key) && !behaviours.some((b) => b.tokens.has(key)) ? 'decision' : 'turn',
      conservation,
      presentIn: presentBehaviours.length,
      meanPosition: position.get(key) ?? 0,
      baselineTokens: Math.round(mean(presentBehaviours.map((b) => b.tokens.get(key) ?? 0))),
      variableSlots: [...slotNames].sort(),
      classification:
        conservation === 1 ? 'invariant' : conservation >= 0.6 ? 'common' : 'variable',
      replacedBy: columnOf.get(key) ?? null,
    };
  });
  const rows: AlignmentRow[] = behaviours.map((b) => ({
    traceId: b.trace.id,
    scenarioId: b.trace.task.scenarioId,
    variantKey: b.trace.task.variantKey,
    cells: sortedKeys.map((key) => ({
      key,
      present: b.counts.has(key),
      count: b.counts.get(key) ?? 0,
      detail: b.detail.get(key) ?? '',
    })),
  }));

  const spec: ReflexSpec = {
    schema: 'bigforge.reflex/v1',
    name: input.name,
    version: input.version ?? '1.0.0',
    familyId: input.familyId,
    description:
      'Learns the repeated procedure for diagnosing and repairing a failing monorepo build: normalise the log, find the root cause, inspect, decide on a remedy, patch, and verify with independent evidence.',
    inputs,
    preconditions: [{ op: 'in', left: { ref: 'env.toolchain_major' }, right: { const: majors } }],
    steps,
    outputs,
    permissions,
    verify: [
      {
        id: 'original_failure_gone',
        description: 'The original build failure no longer reproduces',
      },
      { id: 'relevant_tests_pass', description: 'Relevant tests pass' },
      { id: 'no_unrelated_changes', description: 'Only files in the root-cause workspace changed' },
      {
        id: 'security_policy_pass',
        description: 'No protected paths, scripts, secrets or unpinned dependencies changed',
      },
    ],
    compatibility: { toolchain: { name: toolName, observed: versions, range } },
    rollbackTo: input.rollbackTo ?? null,
    provenance: {
      compilerVersion: COMPILER_VERSION,
      sourceTraceIds: traces.map((t) => t.id),
      sourceVariants: [...new Set(traces.map((t) => t.task.variantKey))].sort(),
      excludedTraceIds: [],
      assumptions,
      mutationOf: input.mutationOf ?? null,
    },
  };

  const report: CompileReport = {
    compilerVersion: COMPILER_VERSION,
    tracesUsed: n,
    variants: spec.provenance.sourceVariants,
    columns,
    rows,
    decisions,
    excludedBehaviours: excluded,
    uncovered,
    baselineTokensPerTask: Math.round(mean(traces.map((t) => t.usage.totalTokens))),
    baselineModelCallsPerTask: Math.round(mean(traces.map((t) => t.usage.modelCalls)) * 10) / 10,
  };
  return { spec, report };
}
