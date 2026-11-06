# Security and Governance

BigForge executes commands and learns from untrusted text (logs, repository files, tool output). This document states what is actually enforced, what is *not*, and how to read the claims.

## Containment levels: read this first

| Level | What it is | BigForge status |
|---|---|---|
| **Application-level containment** | The application validates and constrains every action before it happens: structured commands, allowlists, path confinement, permission checks, scrubbed environment, timeouts, output caps | **Implemented and tested** (`packages/security`, `packages/core/src/sandbox.ts`) |
| **Container isolation** | The server runs in a container with a non-root user | Dockerfile provided; **not validated as a security boundary** |
| **Production-grade sandboxing** | seccomp/AppArmor profiles, user/network/PID namespaces, cgroup limits, read-only root, gVisor/Firecracker/nsjail | **Not implemented.** No network namespace, no syscall filtering, no cgroup memory/CPU enforcement |

BigForge does **not** claim OS-grade sandboxing. The synthetic lab's only executable is a deterministic Node script (`forge-ci`) that performs static analysis and cannot reach the network by construction; that is a property of the lab tool, not of a sandbox.

## Controls

### Execution safety
- **No shell, ever.** Commands are `{program, args[]}` where `program` is an allowlist id. Shell control characters (`; & | < > \n` backticks, `$(`) are rejected outright; model-proposed command lines are parsed without shell semantics.
- **Allowlist semantics**: unknown program, subcommand, flag, positional or flag value shape → denied. Prototype-key names (`constructor`, `__proto__`) are rejected with `Object.hasOwn`.
- **Destructive-operation blocking**: `rm -rf`, `git reset --hard`, `git clean`, `git push --force`, `dd`/`mkfs`, `chmod -R`, `curl | sh`, `sudo`, `DROP TABLE`, shutdown... are classified and blocked (they are also simply not on the allowlist).
- **Path confinement**: lexical rejection of absolute paths, `..` escapes, NUL bytes, drive prefixes, plus `realpath` checks so symlinks cannot escape the working directory. Permissions are evaluated on **both** the requested path and the real path it resolves to, so a link inside a writable directory cannot reach a protected file; writes through a symbolic link (including a dangling one) are refused, and change manifests record links, so creating or retargeting one is visible to the verifier.
- **Permission evaluation (least privilege)**: each Reflex declares `read`/`write` globs and command patterns derived from its operators; the executor always runs under *its own declared permissions*, never the caller's. Protected paths (`forge.lock.json`, `.github/**`, `ci/**`, `.env*`, `node_modules/**`) are never writable.
- **Process limits**: scrubbed environment (the parent environment is never inherited), timeout with SIGKILL, per-stream output cap, `--max-old-space-size=128`.
- **Verification-first completion**: success is decided by an independent verifier (build, tests, file-manifest diff, security policy), not by an agent's claim.

### Data and model safety
- **Secret redaction at capture**: private keys, bearer and Basic credentials, JWTs, cloud, GitHub, Slack and API keys, Azure account keys and SAS signatures, URL credentials and `secret=` assignments are redacted before anything enters a trace, a log or a model prompt. Every pattern is length-bounded, so adversarial logs cannot trigger quadratic backtracking. The lab plants a fake token in `forge.config.json` to prove it.
- **Evidence is data, not instructions**: the Token Firewall screens evidence for instruction-like content (`ignore previous instructions`, `curl … | sh`, role markers), withholds those lines and records the finding.
- **Bounded model calls**: at most 3 per run, a per-call token budget, duplicate calls denied, cost cap, optional human approval. One verdict among `ALLOW · REDUCE_CONTEXT · USE_SMALLER_MODEL · USE_EXISTING_REFLEX · REQUEST_HUMAN_APPROVAL · DENY · ESCALATE`.
- **Model-output validation**: answers must parse as JSON, match a schema, and choose one of the offered option ids. Anything else stops the Reflex (safe fallback to the baseline); model output never becomes code or a command.
- **Compile only from verified successes**, never from blocked or failed behaviour (blocked destructive attempts are listed as *excluded behaviours*). A Reflex contains data, not code: conditions and bindings are a closed declarative language with no `eval`.

### Access control and tenancy
- **RBAC** (`viewer < operator < reviewer < admin`) is enforced in the service layer on every action; the UI only mirrors it.
- **Human approval for promotion**: only `reviewer`/`admin` can promote; the server re-checks the evidence gate and the content hash. Generated Reflexes are never auto-promoted; drift demotes automatically (the safe direction); mutations are only proposed.
- **Tenant isolation**: every table carries `tenant_id` and is reachable only through `TenantStore`, which adds the tenant filter to every statement. Tests prove cross-tenant reads and writes fail (store level and HTTP level).
- **Sessions**: HMAC-signed cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production mode, 8-hour expiry; the user, role and tenant are re-read from the database on every request, so a removed user or a changed role takes effect immediately. Sessions are stateless: sign-out clears the cookie but cannot revoke a copied cookie before it expires. Passwords use scrypt with constant-time comparison; login failures use one generic message, a dummy hash for unknown users, and a per-client-address+email rate limit with bounded memory (behind a reverse proxy set `BIGFORGE_TRUST_PROXY_HOPS` so the real client address is used).
- **CSRF**: every mutating API call must carry `X-BigForge-Client` (a custom header a cross-site form cannot set) and must not be labelled `Sec-Fetch-Site: cross-site|same-site` by the browser. The authentication and CSRF hooks are attached to an encapsulated scope that contains every API route and match public routes by their registered pattern, never by the request URL string, so a percent-encoded or absolute-form spelling cannot skip them.
- **DNS rebinding**: a server bound to loopback accepts only loopback `Host` headers (plus `BIGFORGE_ALLOWED_HOSTS`).
- **HTTP hardening**: strict CSP (`default-src 'self'`, `script-src 'self'` with no inline script, `frame-ancestors 'none'`; inline *styles* are allowed because the UI sets computed style attributes), `nosniff`, 256 KB body limit, bounded pagination (≤ 100), zod validation on every input.
- **Production mode** fails closed: `BIGFORGE_MODE` accepts only `demo` or `production` (an unset mode means demo and is refused when `HOST` is a non-loopback address); production requires `BIGFORGE_SESSION_SECRET` (≥ 32 chars), refuses to start on a database that contains the public demo identities, and turns off the guided demo, seeding and reset (the first admin comes from `BIGFORGE_BOOTSTRAP_ADMIN_EMAIL` / `_PASSWORD`, at least 12 characters).
- **Demo helpers are role-gated**: fast-forwarding past the human approval requires the right to promote and is recorded as a simulated approval by a system identity (`human: false`, `seeded: true`), never as a named reviewer; only an admin of the primary demo tenant can reset the (shared) demo database.
- **Live provider**: credentials travel only over `https` (plain `http` is accepted for `localhost` stubs), redirects are never followed, and response size is capped.

### Integrity and audit
- Reflex versions are immutable and **content-hashed**; the executor and the promotion path verify the hash and refuse to run a tampered Reflex.
- `audit_events` is **append-only** (database triggers) and **hash-chained per tenant**. `GET /api/audit/verify` recomputes the chain. Tamper-evident, **not** WORM storage: someone with raw database access can drop the triggers, but doing so breaks the chain and verification reports the first broken sequence number.

## Threat model (condensed)

| Threat | Mitigation | Residual risk |
|---|---|---|
| Prompt injection inside logs/files steering the agent | Evidence screening; structured tool calls; compile only from verified traces; model output validated and never executed | A sophisticated injection could still mislead a *live* model's judgement at a boundary; verification catches wrong results |
| Command injection via model-proposed commands | No shell; allowlist; structured args; path flags confined | A bug in the allowlist definitions (kept tiny: one program) |
| Path traversal / symlink escape | Lexical + realpath confinement; permissions checked on the real path; writes through links refused | Race between check and use (TOCTOU) inside one process; not OS-enforced |
| Runaway spend | Per-run call cap, budgets, duplicate denial, cost cap, bounded loops (agent ≤ 16 turns, token budget) | Provider-side billing is outside BigForge's control |
| Poisoned Reflex | Immutable content hash; human promotion; shadow evidence gate; drift canary | Human reviewers can approve a flawed Reflex; verification quality bounds safety |
| Cross-tenant data access | `TenantStore` filtering; tests | A new query written outside `TenantStore` would bypass it (code review rule) |
| Secret leakage into traces/logs/prompts | Redaction at capture; logs carry metadata only | Redaction is pattern-based and can miss novel formats |
| Audit tampering | Append-only triggers + hash chain | Not WORM; raw DB access can destroy (not silently alter) history |

## Independent security review (2026-11-06)

A read-only review of the backend (`packages/*`, `apps/api`, `apps/worker`, scripts) was run by a separate security-review agent. It confirmed seven issues and found tenant isolation, SQL parameterisation, the audit chain, session handling, command validation (a ~200k-case fuzz found no bypass) and static-file serving sound. Every confirmed issue was fixed and has a regression test; the review is *not* a substitute for a human penetration test.

| # | Severity | Finding | Fix | Regression test |
|---|---|---|---|---|
| 1 | High | An operator could fast-forward the demo past the human approval via `POST /api/demo/seed`, producing a promotion attributed to a reviewer | Seeding is demo-mode only, needs the right to promote when it would approve, and records a simulated approval by a system identity | `packages/platform/test/integrity.test.ts`, `apps/api/test/api.test.ts` |
| 2 | Medium | Auth and CSRF hooks keyed on the raw URL string, so `/%61pi/...` skipped the CSRF header check | Hooks live in an encapsulated scope, public routes matched by pattern, `Sec-Fetch-Site` check added | `apps/api/test/api.test.ts` (request-level defences) |
| 3 | Medium | Production mode failed open (typos, unset mode) and a demo-seeded database kept public credentials | Strict mode parsing, refusal to start on a database with demo identities, demo endpoints disabled in production | `packages/platform/test/security.test.ts` |
| 4 | Medium | Symbolic links let a write reach protected files or create files outside the root | Permissions checked on the real path, writes through links refused, links recorded in manifests | `packages/core/test/sandbox-symlink.test.ts` |
| 5 | Low | A shared mutable object leaked one tenant's demo task ids to another | Fresh context per load | `packages/platform/test/security.test.ts` |
| 6 | Low | `in` checks accepted prototype keys (`__proto__`) for the toolchain version, file manifests and dependency checks | `Object.hasOwn` and null-prototype manifests | `packages/core/test/sandbox-symlink.test.ts` |
| 7 | Low | Missing role checks (re-match, presenter cursor), jobs queued for unknown versions, shadow runs accepting training scenarios, any tenant admin able to reset the shared demo | Role checks, 404 at enqueue, shadow limited to the held-out scenarios, reset limited to the primary demo tenant's admin | `apps/api/test/api.test.ts`, `packages/platform/test/security.test.ts` |

Availability and hardening items from the same review were also addressed: quadratic secret redaction and instruction screening (86 s and 10 s on adversarial input, now well under a second), more secret formats, a bounded login limiter with proxy-aware client addresses, a loopback Host allowlist, https-only no-redirect live provider calls.

**Accepted and documented**: sessions cannot be revoked before expiry; the login limiter is a per-process fixed window; the baseline agent's tool observations are not screened for injected instructions in live mode (the Token Firewall does screen boundary evidence); redaction remains pattern-based.

## Responsible AI

- **Human in the loop**: promotion, rejection, rollback and mutation approval are explicit, attributed, audited actions. Demotion on drift is automatic and always available.
- **Legible automation**: every Reflex step records why it exists (which baseline behaviours it replaces, how consistently, which alternatives were tried and why one was chosen); every boundary call records the seven firewall answers and what evidence was withheld.
- **Assumptions are surfaced**: the compiler lists the assumptions it had to make (for example "assumes the log lists a root failure before its consequences"); a reviewer sees them before promoting. In the demo that very assumption is what later fails.
- **Observable behaviour only**: learning uses visible traces, tool actions, evidence and outcomes, never model internals. Review provider terms on output retention and reuse before storing live traces.
- **Synthetic data only** in the proof of concept; no real user data.
