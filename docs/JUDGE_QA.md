# Judge Q&A preparation

Short, honest answers to the questions a technical judge is most likely to ask. Every claim points at something you can open in the running product or in this repository. If a question lands outside what is built, say so; [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md) is the source of truth.

> Numbers quoted below come from the offline **deterministic provider on the synthetic monorepo lab** (labelled `synthetic` in the product). They demonstrate the mechanism and the accounting; they are not benchmark results.

## The idea

**What is BigForge in one sentence?**
It watches successful agent runs, compiles the steps that never change into verified executable _Reflexes_, and calls a model only at the one decision it cannot make deterministically, with the least evidence that decision needs.

**How is that different from prompt compression, memory, caching or routing?**
Those make a model call cheaper or better informed. BigForge asks whether the call needs to exist. They are complementary: the Token Firewall compresses and routes the residual call, caching still applies to it, and memory can feed the evidence.

| Approach          | What it changes                                  | Relationship                                      |
| ----------------- | ------------------------------------------------ | ------------------------------------------------- |
| Compression       | Fewer tokens per call                            | Applied inside the Token Firewall                 |
| Memory / RAG      | What the model can recall                        | The model still reasons                           |
| Semantic caching  | Reuses a past answer for a similar request       | BigForge runs a verified procedure on _this_ input |
| Model routing     | Which model answers                              | The Firewall picks a tier for the boundary call   |
| **BigForge**      | Removes validated, repeated reasoning from calls | Executes known steps locally; verifies the result |

**Why not just let an LLM write a script?**
A free-form generated script is exactly what you cannot trust. A Reflex is data, not code: typed operators from a closed library, a closed condition language (no `eval`), least-privilege permissions, and it is only ever bound to behaviour that reproduced the recorded decision on every source trace. It is then replayed, shadowed, gated and approved by a human before it runs for real.

## Are the savings real?

**Show me the numbers. Are they real?**
The mechanism is real code; the model is scripted. In the demo the baseline agent makes roughly 9–12 model calls per task (about 29–44k synthetic tokens); a known task through the Reflex makes **0** (open the trace: there are no `model_call` events). The held-out ambiguous task makes **1**, carrying about 115 tokens of evidence selected from about 3.5k observed (`synthetic`). We make no claim that real models will behave this consistently.

**Isn't the deterministic provider rigged?**
It is a scripted policy standing in for a model, always labelled `deterministic` / `synthetic`, and never presented as a live call. What it cannot rig: the independent verifier (it re-runs the build and tests and checks that unrelated files did not change), the sandbox, the evidence gates, the firewall, and drift detection run the same code with a live provider. We also test that a plausible-but-wrong repair is caught by the verifier. Agreement between the scripted agent and the operators is partly by construction, which we say in KNOWN_LIMITATIONS.

**Why is dollar ROI lower than token ROI?**
The simulated baseline benefits from prompt caching (about 96% of its input tokens are cache hits, billed at a cached rate), and the economics include an _assumed_ human-review cost. So dollars saved per task are small and dollar ROI can be negative at demo volumes while token ROI projects well above 1×. The Economics page shows both, with provenance, instead of choosing the flattering one. Pricing is a synthetic sheet with a timestamp, not any vendor's list price.

**What is the Cognitive Reuse Ratio?**
A proposed BigForge metric, not an industry standard: the fraction of a Reflex's baseline-token-weighted steps that ran locally without a model. It is only meaningful next to the verification pass rate. Formula and limits: [METRICS.md](./METRICS.md).

## Correctness and safety

**What if a Reflex is wrong?**
It never improvises. Any failed precondition, unexpected output, denied permission or failed verification stops it and hands control back to the baseline agent. Before it can run live it must pass replay (100%), at least 10 shadow runs across at least 3 variants, zero safety violations and at least 95% agreement, and a reviewer must approve; the server re-checks the gate and the content hash at promotion. Afterwards a drift canary keeps comparing it with the baseline.

**How do you avoid learning from one lucky run?**
The compiler refuses single traces and traces without variation, and compiles only from independently verified successes of the right kind. It lists the assumptions it had to make (for example that logs list the root failure first) so a reviewer can see what is fragile.

**What does drift look like, and what happens?**
In the demo a synthetic toolchain upgrade (`forge-ci 1.4.2 → 1.5.0`, parallel builds) reorders logs for some tasks. The simple operator that read the first error now picks a downstream failure. The canary sees agreement fall (75% vs 100% historically), confidence falls, and the Reflex returns to Shadow automatically. A mutation is proposed with a regression replay and left as a candidate; it is never auto-activated. The drift magnitude is tuned for the synthetic lab; the mechanism is real.

**Is the model call safe from prompt injection?**
The model receives only the bounded evidence the firewall selects, screened for instruction-like content, never tools. Its answer must be one of the offered options and is validated before the Reflex continues; garbage or out-of-set answers stop the Reflex. At most three boundary calls per run, each within a declared token budget.

**Is the sandbox secure?**
It is _application-level containment_: structured commands (no shell), program and argument allowlists, path confinement with symlink checks, scrubbed environment, timeouts and output caps, destructive-command blocking. It is not OS-level isolation (no namespaces or seccomp). The Docker image adds container isolation; production-grade sandboxing is roadmap. [SECURITY.md](./SECURITY.md).

**Multi-tenancy and roles?**
Every table goes through one tenant-scoped repository layer; tests prove tenant A cannot read or act on tenant B. Roles are viewer, operator, reviewer, admin; only reviewers and admins can promote. The audit log is append-only (database triggers) and hash-chained; the Governance page verifies the chain.

## Scope and honesty

**What is not built?**
One task family (monorepo build failures) on a synthetic lab; operators come from a typed library (the compiler selects and parameterises, it does not synthesise code); fingerprinting is rule-based, not embedding-based; SQLite on one node; no OS-grade sandbox; the live provider is validated against a protocol stub only; nothing is deployed to Azure.

**What about Azure?**
Bicep for Container Apps, Key Vault, managed identity, Application Insights and an optional Azure OpenAI account is written and validated locally (build and lint). No what-if, deployment or smoke test has been run, and we do not claim otherwise. [AZURE.md](./AZURE.md).

**Does it work without internet?**
Yes. Demo mode needs no network or credentials; fonts are self-hosted; the provider is deterministic. `npm run demo` is the whole setup.

## Value

**Who is it for?**
Teams running coding or operations agents on repetitive, verifiable work (CI triage, build repair, dependency bumps) where the same reasoning is paid for repeatedly. Value shows up as fewer model calls, lower latency, more predictable behaviour and an auditable record of what ran.

**How does it fit Zero-Waste AI?**
Waste here is repeated reasoning. BigForge measures model calls and tokens avoided, and the investment it took to earn them, with the uncertainty in the estimate. We do not claim energy savings.

**How would you validate it on real data?**
Record real agent traces behind the vendor-neutral trace format, run Shadow Brain on held-out tasks, and report agreement, false-match rate and verification pass rate before any live use. The design for that experiment is in [VISION.md](./VISION.md#evaluation-strategy).
