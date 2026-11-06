# Demo guide

How to present BigForge: setup, a thirty-second pitch, a five-minute script, a two-minute fallback and what to do when something goes wrong. Every command here has been run; every claim about the product is one you can show on screen. For hard questions see the [judge Q&A](./JUDGE_QA.md).

> The demo runs offline against a **synthetic monorepo lab** with a **deterministic provider** (a scripted stand-in for a model). Say so early and plainly; it is the foundation of the honest framing. Every number on screen carries a label (`synthetic`, `simulated`, `estimated`, `replay-measured`, `measured`).

## Before you present

1. `npm install`, then `npm run demo`. Wait for the line `BigForge demo: http://127.0.0.1:4747`.
2. Open <http://127.0.0.1:4747> in a desktop browser (1440×900 or larger is ideal; 1366×768 works).
3. Sign in as **Grace** (`grace@acme.test`, password `forge-demo`). Grace is a reviewer: the human promotion step needs a reviewer or admin.
4. Check the Forge strip at the top: it must read **Deterministic provider · synthetic**. If you want the guided overlay chrome-free, use the presenter bar's presentation layout; `Esc` exits.
5. Make sure the demo is at step 1. If you ran it before: sign in as **Ada** (`ada@acme.test`, admin) and use **Reset demo** on the Forge Floor (it asks for confirmation), then sign back in as Grace. Reset recreates the demo database and starts a new audit chain.
6. Nothing needs the internet (fonts are bundled, the provider is deterministic), so Wi-Fi problems cannot break the demo.

Time budget: the whole demo is about 40 seconds of compute on an idle laptop, spread over thirteen actions (most take a few seconds; Shadow Brain and the mutation proposal take the longest). A progress line shows while an action runs; narrate over it.

## Thirty-second pitch

> AI agents pay full price to re-solve problems they have already solved. BigForge learns from verified runs and compiles the steps that never change into a **Reflex**, then calls a model only at the one decision it cannot make deterministically, with the least evidence that decision needs. It proves a Reflex before trusting it, a human approves it, every result is verified independently, and when the world changes it demotes itself. Everything you will see runs offline on a synthetic lab with every number labelled: the mechanism is real; the savings are a demonstration, not a benchmark.

## Five-minute script

The presenter bar (bottom of the screen) drives everything: **Next** moves on, the step's action button does the real work, **Back** and **Restart** are always available, and the arrow keys and `R` work too. Steps in `code` are the server's step numbers.

| Time      | Scene (steps)            | You do                                                                 | Say                                                                                                                                                                                                      |
| --------- | ------------------------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0:00–0:30 | Hook                     | Forge Floor: read the pitch, then **Start guided demo**                | The thirty-second pitch. Point at the provider chip: deterministic, synthetic.                                                                                                                           |
| 0:30–1:15 | Cold start (`1`–`3`)     | **Send failure to BigForge**, then **Run the baseline agent**, then **Next** to the trace | "A monorepo build breaks: eight workspaces, one root cause. No Reflex exists, so the agent does everything and calls the model every turn." Point at the model-call count and synthetic tokens; the planted secret in the log is redacted at capture. |
| 1:15–2:00 | Learning (`4`–`7`)       | **Process four more failures**, **Discover task families**, **Align traces and compile** | "Five related failures, one recurring family. Compare the traces: solid columns never change, hatched columns vary. That is the Reflex DNA: the invariant steps become a Reflex; the judgement calls stay open." |
| 2:00–2:45 | Validation (`8`–`11`)    | **Replay historical traces**, **Run Shadow Brain**, read the comparison, then **Promote Reflex** | "Replayed against history, then run beside the baseline in shadow mode: same outcome, same root cause, far fewer calls. The gate says what is still missing. Nothing goes live without a human: I am promoting it as Grace, the reviewer, and that is recorded." |
| 2:45–4:00 | The killer moment (`12`–`20`) | **Send the new failure**, then **Execute through the Reflex**, then **Next** through the boundary, firewall and answer | "A new task, deliberately ambiguous. The family is recognised and the Reflex selected. Known steps run with **zero** model calls. Here is the one place judgement is needed: the Uncertainty Boundary. The Token Firewall looks at everything observed, selects the few chunks that matter, and authorises one bounded call. The model answers only that question; the answer is validated; the Reflex continues; an independent verifier confirms the fix. Compare with the baseline on the same task." |
| 4:00–4:45 | Drift (`21`–`25`)        | **Update the build tool**, **Run the Drift Canary**, **Next** to the end, **Propose a mutation** | "Now the world changes: a synthetic toolchain upgrade reorders the logs. The canary replays tasks against the baseline, finds disagreement at one step, confidence falls, and the Reflex drops back to Shadow by itself. A repair is proposed; it is **not** activated. A reviewer decides." |
| 4:45–5:00 | Close                    | Open **Economics** from the left rail                                   | "Is it worth it? Tokens: yes. Dollars: it depends, because the baseline benefits from caching and we count human review time. We show both and say so. Everything here is synthetic and offline; Azure templates are validated locally, not deployed."                                    |

What to point at in the killer moment (steps 15–17): the Forge Graph with the boundary node glowing molten amber (the only persistent glow in the product), the Uncertainty Lens (about 3,500 tokens of evidence observed against about 100 sent), and the verdict path chips (`REDUCE_CONTEXT › USE_SMALLER_MODEL › ALLOW`). All figures are `synthetic`.

## Two-minute fallback

Use it when you are short of time or a live action misbehaves.

1. On the Forge Floor choose **Fast-forward** and pick **complete** (as Grace this includes the approval step, which is recorded as a seeded approval by a system identity, never as a named reviewer). Then open the three views below from the left rail.
2. **Run Console** (`/run`) on the held-out task: the Forge Graph with the boundary, the Uncertainty Lens and the baseline-vs-Reflex comparison. (45 s)
3. **Economics** (`/economics`): token ROI and dollar ROI side by side, the break-even chart, the assumptions. Say what the sign of the dollar ROI means. (30 s)
4. **Drift** (`/drift`): the fracture across the diverging step, the canary grid, the proposed mutation (not activated). (30 s)
5. Close with the limitations line (15 s): synthetic lab, scripted model, one task family, Azure not deployed.

Headless alternative, if no screen is available: `npm run demo:verify` prints PASS/FAIL for every claim of the 25 steps (killer task = one model call, evidence reduced from about 3.5k to about 100 tokens, mutation left as a candidate, audit chain verified).

## If something goes wrong

| Symptom                                    | Fix                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| A step shows a progress line for a long time | Jobs run in the server process; give it up to a minute on a slow machine. The state lives on the server, so reloading the page is safe. |
| Port 4747 is in use                        | `PORT=4848 npm run demo`                                                                                     |
| Want to start over                         | Presenter **Restart** goes back to step 1; as Ada, **Reset demo** on the Forge Floor recreates the demo data |
| The promote button is disabled             | You are not signed in as a reviewer or admin. Sign in as Grace. (An operator sees why it is disabled; that is the point of the role.) |
| Someone asks if it is calling a real model | No: the strip says deterministic provider, synthetic. Live mode (Azure OpenAI or OpenAI-compatible) is optional and is validated against a protocol stub only |
| Something looks wrong on screen            | Say what you see and move on: every claim is also checked headlessly by `npm run demo:verify`               |

## Roles to show off (optional)

Switch persona from the identity menu: **Linus** (operator) can run tasks but cannot promote; **Vera** (viewer) is read-only; **Gus** (another tenant's admin) sees none of Acme's data. Governance shows the audit chain and verifies it.
