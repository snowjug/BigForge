# Metrics, Provenance and Formulas

BigForge's central claim is about **model consumption**, so accounting must be honest. Every number carries a provenance label; estimated and observed values are never blended into one unlabeled figure.

## Provenance labels

| Label | Meaning | Examples |
|---|---|---|
| `measured` | Observed from a real system | local command duration; live-provider usage; the matcher's false-match rate on its corpus |
| `synthetic` | Produced by the deterministic provider (a scripted stand-in for a model) | token counts, cached-token counts, cost derived from them |
| `simulated` | Computed from a documented deterministic model | model latency of the deterministic provider |
| `estimated` | Counterfactual or projected from other data | tokens avoided when no baseline reference exists; ROI projections |
| `replay-measured` | Measured by re-running a recorded task against a Reflex | replay results, CRR of replayed runs |

## Token accounting

- **Deterministic provider tokens**: `ceil(UTF-8 bytes / 4)` per message (+4 per message framing, +tool-schema tokens). Always `synthetic`.
- **Cached tokens**: the deterministic provider simulates prompt caching by the longest shared message prefix with the previous request in the same run. `synthetic`. Cached input is billed at the cached rate.
- **Simulated latency**: `250 ms + 0.28 ms × uncached input + 0.06 ms × cached input + 14 ms × output tokens`. `simulated`.
- **Live provider**: provider-reported `usage` (`measured`) and wall-clock latency (`measured`).
- **Pricing** is configuration, not fact. The default is a *synthetic demo price sheet* (`forge-sim-demo-2026-11`, assumed 2026-11-06): large $3 / $12 per M input/output tokens, cached input $0.30; standard $0.80 / $3.20; small $0.25 / $1.00. It is not any vendor's list price. Cost provenance is `synthetic` for deterministic tokens and `estimated` for live tokens priced with these assumptions.

Because caching makes repeated context cheap, **token savings and dollar savings differ**. The dashboard shows both and says so.

## Cognitive Reuse Ratio (CRR)

A *proposed BigForge metric*, not an industry standard.

```text
CRR(run) = Σ w_s over steps that ran locally without a model (status ok)
           ──────────────────────────────────────────────────────────────
           Σ w_s over all steps of the Reflex

w_s = mean baseline tokens spent on the behaviours step s replaces (minimum 1)
```

Steps that crossed an uncertainty boundary, stopped, or never ran count as *not reused*. CRR is only meaningful beside the **verification pass rate**: reusing the wrong thing confidently yields a high CRR and a bad outcome. Run-level CRR is `replay-measured`.

## Cognitive ROI

```text
Cognitive ROI = (cost avoided − cost to learn) ÷ cost to learn
```

- **Cost to learn (investment)** counts: shadow reference runs and comparison reference runs, drift-canary reference runs, compilation (0 model tokens, wall time reported), replay (local commands only), and human review (cost view only: *assumed* 10 minutes at $75/hour, `estimated`). The learning-phase baseline runs are excluded by default because those tasks had to be solved anyway; a **conservative toggle** includes them.
- **Cost avoided** per execution = baseline tokens (or cost) for the task − the Reflex's actual tokens. If a **measured baseline reference** exists for that task the basis is `measured_reference`; otherwise it is the mean of baseline samples (`counterfactual_estimate`, label `estimated`); before any live execution it is the shadow-run difference (`shadow_estimate`).
- **Uncertainty interval**: mean ± 1.96 · σ/√n of baseline samples, propagated to ROI.
- **Realised** = what the live executions saved so far. **Projected** = per-execution saving × an explicit assumed execution count (default 200) and is *not a forecast*.
- **Break-even** = ⌈investment tokens ÷ per-execution saving⌉ executions. The break-even chart plots cumulative baseline tokens against cumulative BigForge tokens (investment first) on the same basis as that saving, namely the mean baseline and Reflex tokens of the executions that produced it, so its two lines cross exactly at the break-even.

## Reflex confidence (trust)

```text
confidence = (agreements + 1) / (n + 2)        over the most recent 12 comparisons
```

A Beta(1,1)-prior posterior mean over shadow, canary and live-verification results, with a 90% Wilson interval shown. Example estimator; thresholds are configurable and not validated.

## Drift detection

Drift is **confirmed** when the canary has at least `minSamples` (8) results **and** agreement fell by at least `dropThreshold` (10 points) versus the shadow history **and** is below `floor` (90%). On confirmation an active Reflex moves `active → watch → shadow` automatically (the safe direction). A mutation may then be *proposed*; it is never activated without a reviewer.

## Promotion gate (server-enforced)

Defaults (configurable, **not validated**): replay agreement 100% on at least one trace; ≥ 10 shadow runs across ≥ 3 distinct variants; 0 Reflex safety violations; ≥ 95% shadow agreement. Evaluated on the server at promotion time together with the role check and the content-hash integrity check.

## Agreement (Shadow / Replay / Canary)

Two executions of the same task agree when: same outcome status, both independently verified, same root cause, same final file contents, and the Reflex made **no** blocked/unsafe action. A Reflex safety violation disqualifies it regardless of other agreement.

## Matcher false-match rate

Measured on a labelled **synthetic** corpus: 18 in-family lab tasks and 12 hand-written out-of-family tasks (feature request, flaky test, deploy failure, lint failure, other toolchains, performance, refactor, explain-only...). Reported with the corpus size; it demonstrates the mechanism, not a general rate.
