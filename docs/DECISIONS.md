# Decision Log

Short architecture decision records. Newest last. Each entry: decision, why, and what would change it.

## D-001 — Modular monolith, npm workspaces

One deployable (API + static web + in-process job runner) plus an optional external worker entrypoint sharing the same application layer (`packages/platform`). No pnpm/yarn (not installed; npm workspaces are sufficient). **Change if:** independent scaling of replay workers is needed.

## D-002 — TypeScript 6.0 (not 7)

TypeScript 7 is the current release, but `typescript-eslint` declares `typescript <6.1.0`. Strict linting matters more than the newest compiler. **Change if:** `typescript-eslint` supports TS 7.

## D-003 — `node:sqlite` for local persistence

No native build step, offline, zero dependencies, ships with Node 24. Versioned SQL migrations with checksums. A repository layer keeps tenant scoping in one place so a PostgreSQL adapter is possible later. **Limitation:** SQLite is single-node; this is a demo/POC datastore, not a production datastore.

## D-004 — Packages consumed as TypeScript source

Workspace packages export `./src/index.ts`; `tsx`/Vitest/Vite/esbuild transform them. `erasableSyntaxOnly` keeps code compatible with Node type stripping. Production server is an esbuild bundle (`dist/server`).

## D-005 — Provenance on every number

Every metric carries one of `measured | synthetic | simulated | estimated | replay-measured`. The deterministic provider's tokens are `synthetic`; its latency is `simulated`; local command durations are `measured`. Estimated and observed values are never merged into one unlabeled figure.

## D-006 — The deterministic provider is a scripted policy, not a model

In demo mode a policy function plays the role of the model so the whole product runs offline and reproducibly. It is always labeled `deterministic` / `synthetic` and is never presented as a live model call. The agent loop, tool gateway, firewall and verification run identical code in live mode; only the `Provider` differs.

## D-007 — The Reflex Compiler composes a typed operator library

The compiler aligns multiple traces, finds invariant and variable steps, and binds each model decision to a deterministic operator **only if that operator reproduces the recorded decision on every trace** (derive-or-escalate). Decisions with no consistent operator, or whose operator reports low confidence, remain uncertainty boundaries. It does **not** synthesize arbitrary code. When two operators are equally consistent it prefers the simpler one and records the ambiguity; this is what makes the later drift scenario honest (the simple operator overfit to sequential logs).

## D-008 — Sandbox is application-level containment

Structured command specs (no shell), program/argument allowlists, working-directory confinement, path-traversal and symlink checks, scrubbed environment, timeouts and output caps. **Not** OS-grade isolation. Docs distinguish application-level containment, container isolation, and production-grade sandboxing.

## D-009 — Promotion is always human

Generated Reflexes are never auto-promoted or auto-activated. Promotion requires role `reviewer|admin`, passing evidence gates (server-enforced), and creates an approval record + audit event. Drift demotes automatically (safe direction); mutations are only *proposed*.

## D-010 — Direct delivery to `main`

Per the delivery directive, final delivery targets `origin/main` without force-push or history rewrite. If protection or credentials block it, push a feature branch and open a PR.
