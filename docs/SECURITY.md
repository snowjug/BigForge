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
- **Path confinement**: lexical rejection of absolute paths, `..` escapes, NUL bytes, drive prefixes, plus `realpath` checks so symlinks cannot escape the working directory.
- **Permission evaluation (least privilege)**: each Reflex declares `read`/`write` globs and command patterns derived from its operators; the executor always runs under *its own declared permissions*, never the caller's. Protected paths (`forge.lock.json`, `.github/**`, `ci/**`, `.env*`, `node_modules/**`) are never writable.
- **Process limits**: scrubbed environment (the parent environment is never inherited), timeout with SIGKILL, per-stream output cap, `--max-old-space-size=128`.
- **Verification-first completion**: success is decided by an independent verifier (build, tests, file-manifest diff, security policy), not by an agent's claim.

### Data and model safety
- **Secret redaction at capture**: private keys, bearer tokens, JWTs, cloud keys, URL credentials and `secret=` assignments are redacted before anything enters a trace, a log or a model prompt. The lab plants a fake token in `forge.config.json` to prove it.
- **Evidence is data, not instructions**: the Token Firewall screens evidence for instruction-like content (`ignore previous instructions`, `curl … | sh`, role markers), withholds those lines and records the finding.
- **Bounded model calls**: at most 3 per run, a per-call token budget, duplicate calls denied, cost cap, optional human approval. One verdict among `ALLOW · REDUCE_CONTEXT · USE_SMALLER_MODEL · USE_EXISTING_REFLEX · REQUEST_HUMAN_APPROVAL · DENY · ESCALATE`.
- **Model-output validation**: answers must parse as JSON, match a schema, and choose one of the offered option ids. Anything else stops the Reflex (safe fallback to the baseline); model output never becomes code or a command.
- **Compile only from verified successes**, never from blocked or failed behaviour (blocked destructive attempts are listed as *excluded behaviours*). A Reflex contains data, not code: conditions and bindings are a closed declarative language with no `eval`.

### Access control and tenancy
- **RBAC** (`viewer < operator < reviewer < admin`) is enforced in the service layer on every action; the UI only mirrors it.
- **Human approval for promotion**: only `reviewer`/`admin` can promote; the server re-checks the evidence gate and the content hash. Generated Reflexes are never auto-promoted; drift demotes automatically (the safe direction); mutations are only proposed.
- **Tenant isolation**: every table carries `tenant_id` and is reachable only through `TenantStore`, which adds the tenant filter to every statement. Tests prove cross-tenant reads and writes fail (store level and HTTP level).
- **Sessions**: HMAC-signed cookie, `HttpOnly`, `SameSite=Lax`, `Secure` in production mode, 8-hour expiry, re-validated against the database on every request. Passwords use scrypt with constant-time comparison; login failures use one generic message, a dummy hash for unknown users, and a per-IP+email rate limit.
- **CSRF**: every mutating `/api/*` call must carry `X-BigForge-Client`, a custom header a cross-site form cannot set.
- **HTTP hardening**: strict CSP (`default-src 'self'`, `script-src 'self'` with no inline script, `frame-ancestors 'none'`; inline *styles* are allowed because the UI sets computed style attributes), `nosniff`, 256 KB body limit, bounded pagination (≤ 100), zod validation on every input.
- **Production mode** requires `BIGFORGE_SESSION_SECRET` (≥ 32 chars), disables demo identities and demo reset.

### Integrity and audit
- Reflex versions are immutable and **content-hashed**; the executor and the promotion path verify the hash and refuse to run a tampered Reflex.
- `audit_events` is **append-only** (database triggers) and **hash-chained per tenant**. `GET /api/audit/verify` recomputes the chain. Tamper-evident, **not** WORM storage: someone with raw database access can drop the triggers, but doing so breaks the chain and verification reports the first broken sequence number.

## Threat model (condensed)

| Threat | Mitigation | Residual risk |
|---|---|---|
| Prompt injection inside logs/files steering the agent | Evidence screening; structured tool calls; compile only from verified traces; model output validated and never executed | A sophisticated injection could still mislead a *live* model's judgement at a boundary; verification catches wrong results |
| Command injection via model-proposed commands | No shell; allowlist; structured args; path flags confined | A bug in the allowlist definitions (kept tiny: one program) |
| Path traversal / symlink escape | Lexical + realpath confinement | Race between check and use (TOCTOU) inside one process; not OS-enforced |
| Runaway spend | Per-run call cap, budgets, duplicate denial, cost cap, bounded loops (agent ≤ 16 turns, token budget) | Provider-side billing is outside BigForge's control |
| Poisoned Reflex | Immutable content hash; human promotion; shadow evidence gate; drift canary | Human reviewers can approve a flawed Reflex; verification quality bounds safety |
| Cross-tenant data access | `TenantStore` filtering; tests | A new query written outside `TenantStore` would bypass it (code review rule) |
| Secret leakage into traces/logs/prompts | Redaction at capture; logs carry metadata only | Redaction is pattern-based and can miss novel formats |
| Audit tampering | Append-only triggers + hash chain | Not WORM; raw DB access can destroy (not silently alter) history |

## Responsible AI

- **Human in the loop**: promotion, rejection, rollback and mutation approval are explicit, attributed, audited actions. Demotion on drift is automatic and always available.
- **Legible automation**: every Reflex step records why it exists (which baseline behaviours it replaces, how consistently, which alternatives were tried and why one was chosen); every boundary call records the seven firewall answers and what evidence was withheld.
- **Assumptions are surfaced**: the compiler lists the assumptions it had to make (for example "assumes the log lists a root failure before its consequences"); a reviewer sees them before promoting. In the demo that very assumption is what later fails.
- **Observable behaviour only**: learning uses visible traces, tool actions, evidence and outcomes, never model internals. Review provider terms on output retention and reuse before storing live traces.
- **Synthetic data only** in the proof of concept; no real user data.
