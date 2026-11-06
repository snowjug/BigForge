# Validation Ledger

Every claim of "passing" must be backed by an entry here: date, exact command, result, notes. Failures are recorded with root cause and fix.

| Date (UTC) | Command | Result | Notes |
|---|---|---|---|
| 2026-11-06 | `node -v && npm -v` | v24.22.2 / 11.19.1 | environment detection |
| 2026-11-06 | `npm install --no-audit --no-fund` | PASS (280 packages) | workspaces linked under `node_modules/@bigforge/*` |
| 2026-11-06 | `npx tsc --version` | 6.0.3 | pinned `~6.0.3` |
| 2026-11-06 | `node -e "require('node:sqlite')…"` | PASS | SQLite 3.53.4 available without flags |
| 2026-11-06 | `npx vitest run packages/security` | PASS, 24 tests | redaction, path confinement, command allowlist, sandboxed exec (timeout, output cap, env scrub), RBAC, hash chain, auth, evidence screening |
| 2026-11-06 | `npx vitest run packages/platform` | PASS, 7 tests | baseline agent x5 verified; compile; Reflex 0 model calls; ambiguous task = 1 firewall-approved call (3,541 -> 115 evidence tokens); drift stops safely; full 25-step demo in ~34 s |
| 2026-11-06 | `npx vitest run apps/api` | PASS, 14 tests | auth, CSRF header, rate limit, security headers, RBAC, tenant isolation, bounded lists, unauthorised promotion blocked, command playground, full demo over HTTP, reset + new audit chain |
| 2026-11-06 | `npm run typecheck` / `npx eslint .` | PASS | strict TS 6.0, typed-lint (recommendedTypeChecked), no `any` |
| 2026-11-06 | `PORT=4747 npx tsx apps/api/src/main.ts` + curl | PASS | `/api/health`, `/api/ready`, login, `/api/system` (provider labelled deterministic/synthetic) |
| 2026-11-06 | `npx vitest run packages synthetic-labs apps/api` | PASS, 108 tests in 10 files | security 24, core (firewall, expression language, lifecycle/gate/trust/drift/economics/diff), providers, platform (engine, demo, store, hardening), lab + matcher, API 14 |
| 2026-11-06 | `npx vitest run synthetic-labs` | PASS, 8 tests | all 18 scenarios fail with their documented root cause; 1.4.2 lists the root failure first for 18/18; 1.5.0 reorders exactly S5, S6, S10; a repair that compiles but calls the wrong function is caught by `forge-ci test`; matcher: 18/18 positives matched, 12/12 negatives rejected (0 false matches, synthetic corpus); unknown error class / missing evidence / no family never match |
| 2026-11-06 | `npx tsx scripts/demo-verify.ts` | PASS (~38 s) | 25 steps, killer task = 1 model call (3,541 → 115 evidence tokens, `REDUCE_CONTEXT > USE_SMALLER_MODEL > ALLOW`), mutation regression 17/17, mutation left `candidate`/not activated, audit chain verified |

## Failure log

| Date | What failed | Root cause | Fix |
|---|---|---|---|
| 2026-11-06 | L3 baseline run failed independent verification | Remedy regex captured the trailing period of the version (`^1.9.0.`) | Anchored the version pattern; the independent verifier caught it before any claim of success |
| 2026-11-06 | Compile failed at step `patch` | Operator output key (`remedy_plan`) did not match its declared data name | Renamed data to `remedy`; compiler now reports the first failing trace |
| 2026-11-06 | Demo POST with empty body returned 400 | Fastify rejects empty JSON bodies by default | Custom JSON parser treats empty body as `{}` |
| 2026-11-06 | 25-step demo test hit its 60 s timeout in a full parallel run | Heavy parallel load (two build agents on 4 vCPUs, load average ~14) slowed process-spawning tests; it takes ~34 s on an idle machine | Explicit 300 s timeout on the end-to-end demo test; logs replaced by assertions |
