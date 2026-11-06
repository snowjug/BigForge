# BigForge Execution State

> Resume file. If the Copilot session, VM, or context resets, start here.
> Update after every meaningful milestone (timestamp, branch, commit, validation, blocker, next command).

## Snapshot

| Field | Value |
|---|---|
| Last updated (UTC) | 2026-11-06T09:05Z |
| Branch | `main` (local; **not pushed**) |
| Remote | `origin` → `https://github.com/snowjug/BigForge.git` (confirmed) |
| Base commit | `a879b60` docs: define BigForge proof-of-concept vision |
| Checkpoint commits | `397f1cc` foundation + core engine · `ab1d00f` persistence, services, demo director · `bed996c` HTTP API + design brief · `dcd8f32` observability, worker, build + demo verification · `462524b` engine/provider/hardening/lab tests + architecture, metrics, security, formats docs · `c786654` integrity test, Playwright config, bundle e2e · `d2eec9e` CSP doc fix |
| Active milestone | **M4 (premium UI)**; M1–M3 backend complete and validated; M7 backend tests complete (108 + integrity) |
| Classification target | HACKATHON-READY |

## What exists and works (validated, see VALIDATION_LEDGER.md)

- `packages/schemas`, `security`, `providers`, `core` (engine), `platform` (DB, services, demo director), `observability`, `synthetic-labs/monorepo-build` (forge-ci toolchain + scenarios + operator pack), `apps/api` (Fastify, 14 integration tests), `apps/worker`.
- The full 25-step demo runs headlessly through the real services in ~35 s: `Platform.demo.perform(actor, 25)`; over HTTP: `POST /api/demo/steps/25/perform` (reviewer session). `npx tsx scripts/demo-verify.ts` asserts the headline results.
- Real server: `PORT=4747 npx tsx apps/api/src/main.ts` (health, login, system verified with curl).

## In progress / next

1. **Web UI** (`apps/web`) is being built by background agents (foundation → three page agents). Design brief: [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md). API contract: `packages/schemas/src/api.ts` + `apps/api/src/routes/*.ts`.
2. Azure/CI/Docker assets are being authored by a background agent (allowlist: `infra/**`, `.github/workflows/**`, `Dockerfile`, `.dockerignore`, `docs/AZURE.md`, `scripts/azure-*.sh`). Files exist but are **uncommitted and unreviewed** until the agent reports.
3. Still to do: Playwright critical-flow + accessibility e2e (config and `e2e/bundle.spec.ts` exist), visual validation, container build, README + screenshots + demo guide, release gate, push.

Exact next command: `npm run dev` (API http://127.0.0.1:4747 + Vite http://127.0.0.1:5173), then sign in as `grace@acme.test` / `forge-demo`.

## Environment (detected 2026-11-06)

| Tool | Version | Notes |
|---|---|---|
| Node | 24.22.2 | `node:sqlite` works without flags (SQLite 3.53.4) |
| npm | 11.19.1 | npm workspaces; no pnpm/yarn |
| TypeScript | 6.0.3 | pinned `~6.0` (typescript-eslint supports `<6.1.0`) |
| Vite / Vitest / ESLint | 8.3.6 / 5.1.0 / 10.14.0 | |
| Docker | 29.1.3 | |
| Azure CLI / Bicep | 2.92.0 / 0.48.1 | logged in; **nothing provisioned** |
| gh | 2.103.3 | active account `t-atshukla_microsoft` has READ on this repo; `snowjug` also logged in |
| Playwright browsers | chromium-1248 cached | `~/.cache/ms-playwright` |

## Delivery blocker (resolve at release)

The active `gh` identity has READ-only permission on `snowjug/BigForge`. Pushing `origin/main` needs a credential with write access (the `snowjug` account is also logged in on this machine). Do not force-push. Intermediate work is committed locally only.

## Resume instructions

1. `cd ~/work/BigForge && git status && git log --oneline -5`
2. Read this file, [DECISIONS.md](./DECISIONS.md), [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md), [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md).
3. `npm install` if `node_modules` is missing; `npm run typecheck && npm test`.
4. Continue at the active milestone above.
