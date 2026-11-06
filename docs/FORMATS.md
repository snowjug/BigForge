# Trace Format: `bigforge.trace/v1`

A vendor-neutral record of one execution. The same format captures a baseline agent, a Reflex, a shadow pair member, a replay and a canary run. Schema: `packages/schemas/src/trace.ts` (Zod).

```jsonc
{
  "schema": "bigforge.trace/v1",
  "id": "trc_...", "taskId": "tsk_...",
  "runKind": "baseline | reflex | shadow_baseline | shadow_reflex | replay_reflex | canary_baseline | canary_reflex",
  "agent":    { "name": "baseline-agent", "kind": "baseline|reflex", "reflexId": null, "reflexVersion": null },
  "provider": { "id": "bigforge-deterministic", "mode": "deterministic|live", "model": "forge-sim-large" },
  "environment": { "toolchain": { "name": "forge-ci", "version": "1.4.2" }, "platform": "linux" },
  "task": { "prompt": "...", "scenarioId": "L1", "variantKey": "missing_dependency@packages/security" },
  "startedAt": "...", "endedAt": "...",
  "events": [ /* ordered, discriminated by "kind" */ ],
  "outcome": { "status": "success|failed|stopped|fallback", "summary": "...", "rootFailure": { "workspace": "...", "code": "TS2307", "message": "...", "file": "...", "line": 3 }, "remedyKind": "...", "remedySummary": "...", "changedFiles": ["..."] },
  "verification": { "verifier": "bigforge.verifier/1", "status": "pass|fail|incomplete", "rules": [ { "id": "original_failure_gone", "label": "...", "status": "pass|fail|skipped", "evidence": "..." } ], "verifiedAt": "..." },
  "usage": { "modelCalls": 9, "inputTokens": 0, "outputTokens": 0, "cachedInputTokens": 0, "totalTokens": 0, "tokenProvenance": "synthetic|measured", "costUsd": 0, "costProvenance": "...", "toolCalls": 0, "commands": 0, "localSteps": 0, "blockedActions": 0, "modelLatencyMs": 0, "modelLatencyProvenance": "simulated|measured", "localMs": 0, "localMsProvenance": "measured" },
  "redaction": { "applied": true, "redactions": 3 }
}
```

## Event kinds

| `kind` | Fields (besides `id`, `seq`, `offsetMs`) | Notes |
|---|---|---|
| `model_call` | `purpose?`, `provider`, `usage{inputTokens,outputTokens,cachedInputTokens,provenance}`, `latency{ms,provenance}`, `contextMessages`, `responsePreview`, `toolCalls[]`, `boundaryStepId?` | `purpose` is a harness annotation (see below) |
| `tool_call` | `purpose?`, `tool`, `args`, `status ok|error|blocked`, `durationMs` (always `measured`), `exitCode`, `outputPreview`, `outputBytes`, `blockedReason?`, `spawned` | `spawned` distinguishes real processes from in-process file operations |
| `decision` | `intent`, `by model|operator`, `operator?`, `confidence?`, `output` | The baseline emits `<decision intent="...">{json}</decision>` annotations; operators record their own |
| `step` | `stepId`, `operator`, `status ok|escalated|stopped|skipped`, `executor local|model`, `durationMs`, `confidence?`, `summary` | Reflex executions |
| `boundary` | `stepId`, `question`, `reason`, `verdict` (firewall path), `contextTokensBefore/After` | An uncertainty-boundary crossing |
| `safety` | `action`, `blocked`, `rule`, `reason` | Policy decisions |
| `note` | `level`, `message` | |

`offsetMs` is a **virtual timeline**: simulated model latency plus measured local execution time. It is labelled as such wherever it is plotted.

## Annotations and their limit

The compiler needs to know *what a behaviour was for*. The harness therefore tags each model call with a `purpose` (for example `read_failure_log`, `locate_root_cause`, `apply_remedy`) and asks the model to emit `decision` annotations. A live model can be prompted to do the same; **unannotated third-party traces would need an annotator first** (see [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md)).

## Redaction

Everything that enters a trace passes `redactSecrets` first (tool output, model text, arguments, decisions). The count is recorded in `redaction.redactions`. Previews are truncated (2 KB), and the full CI log is stored only in redacted form.

## Mapping to OpenTelemetry GenAI semantics

`model_call` ↔ a `gen_ai` client span (`gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`); `tool_call` ↔ an execute-tool span. BigForge keeps its own envelope because it adds provenance, verification and Reflex-specific events.

---

# Reflex Specification: `bigforge.reflex/v1`

A Reflex is **data, not code**: a validated DAG of references to typed operators. Schema: `packages/schemas/src/reflex.ts`. Content is immutable and hashed (`sha256` over canonical JSON); lifecycle status, trust and evidence live beside it.

```jsonc
{
  "schema": "bigforge.reflex/v1",
  "name": "first-causal-error", "version": "1.0.0", "familyId": "fam_...",
  "inputs": { "ci_log": { "type": "path", "required": true, "description": "..." } },
  "preconditions": [ { "op": "in", "left": {"ref":"env.toolchain_major"}, "right": {"const":[1]} } ],
  "steps": [
    {
      "id": "decide", "title": "Select the remedy", "kind": "hybrid",
      "operator": { "id": "local.select_remedy", "version": "1.0.0" },
      "args": { "root": {"ref":"steps.locate.output.root_failure"} },
      "dependsOn": ["locate", "map", "graph", "diagnose"],
      "escalateWhen": [ { "op":"lt", "left":{"ref":"steps.decide.confidence"}, "right":{"const":0.8} } ],
      "stopWhen":     [ { "op":"eq", "left":{"ref":"steps.decide.output.candidate_count"}, "right":{"const":0} } ],
      "boundary": {
        "question": "Which candidate replacement resolves the failing import while preserving the call site's intent?",
        "kind": "choose_option", "optionsFrom": "steps.decide.output.candidates", "resolveInto": "remedy",
        "evidenceSelectors": [ {"id":"error","tags":["error"],"required":true}, {"id":"call_site","tags":["call_site"],"required":true}, {"id":"candidates","tags":["candidate_signature"],"required":true} ],
        "budgetTokens": 1500, "minCapability": "standard",
        "evidenceRequired": "A choice among the listed option ids with a one or two sentence rationale",
        "verifyBy": "Rebuild and run the workspace tests; the independent verifier must pass"
      },
      "rationale": { "replaces": ["inspect_lockfile", "decide_remedy", "..."], "conservation": 0.4, "baselineTokens": 17000, "selectedBecause": "...", "alternatives": [ {"operator":"...","consistent":true,"matched":5,"of":5} ] }
    }
  ],
  "outputs": { "root_failure": {"ref":"steps.locate.output.root_failure"}, "remedy": {...}, "report": {...}, "verification": {...} },
  "permissions": { "read": ["packages/**"], "write": ["packages/*/package.json", "packages/*/src/**"], "commands": [ {"program":"forge-ci","subcommands":["build","graph","test"]} ], "limits": { "network": false, "secrets": "none", "timeoutS": 120, "maxOutputBytes": 1000000, "maxSteps": 17 } },
  "verify": [ {"id":"original_failure_gone","description":"..."}, "..." ],
  "compatibility": { "toolchain": { "name": "forge-ci", "observed": ["1.4.2"], "range": ">=1.4.2 <2.0.0" } },
  "rollbackTo": null,
  "provenance": { "compilerVersion": "bigforge.compiler/1.0.0", "sourceTraceIds": ["..."], "sourceVariants": ["..."], "assumptions": ["..."], "mutationOf": null }
}
```

### Closed expression language

`{ "ref": "dotted.path" }` or `{ "const": value }`; conditions are `eq neq lt lte gt gte contains in exists not_exists all any not`. References resolve only over `inputs`, `env` and `steps.<id>.{output,confidence}`; `__proto__`/`constructor`/`prototype` are refused. There is no `eval`, no string templates, no code.

### Step kinds

`known` (deterministic local) · `validation` (deterministic check or command) · `hybrid` (local first; may cross its boundary) · `boundary` (always asks) · `verification` (evaluates declared evidence).

### Lifecycle

`candidate → replay → shadow → approval → active ⇄ watch → shadow → recompile → deprecated → retired`. Transitions are enforced by a state machine (`packages/core/src/lifecycle.ts`); each one is recorded and audited. `approval → active` requires a human with the `reviewer` or `admin` role.

### What the compiler does and does not do

It **aligns** verified-successful baseline traces, **selects** typed operators from a library whose output reproduces the recorded behaviour on *every* trace (otherwise the step stays a boundary), **derives** least-privilege permissions, guards and verification rules, and **records its assumptions**. It does not synthesize new code.
