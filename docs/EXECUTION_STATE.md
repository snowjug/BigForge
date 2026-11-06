# BigForge Execution State

> Resume file. If the Copilot session, VM, or context resets, start here.
> Update after every meaningful milestone (timestamp, branch, commit, validation, blocker, next command).

## Snapshot

| Field | Value |
|---|---|
| Last updated (UTC) | 2026-11-06T09:55Z |
| Branch | `main` (local; **not pushed**) |
| Remote | `origin` → `https://github.com/snowjug/BigForge.git` (confirmed) |
| Base commit | `a879b60` docs: define BigForge proof-of-concept vision |
| Checkpoint commits | `397f1cc` foundation + core engine · `ab1d00f` persistence, services, demo director · `bed996c` HTTP API + design brief · `dcd8f32` observability, worker, build + demo verification · `462524b`/`c786654`/`d2eec9e` tests, docs, Playwright config · `c0cb21e` Azure Bicep, CI, container · `f67b22c` scanner · `55446ce` judge Q&A · `4898f1c` security review fixes (136 backend tests pass) |
| Active milestone | **M4 (premium UI)**: UI foundation + shared viz + three page agents running; M1–M3, M6, M8 (authored, not deployed) done; backend M7 tests done |
| Classification target | HACKATHON-READY |

## What exists and works (validated, see VALIDATION_LEDGER.md)

- `packages/schemas`, `security`, `providers`, `core` (engine), `platform` (DB, services, demo director), `observability`, `synthetic-labs/monorepo-build` (forge-ci toolchain + scenarios + operator pack), `apps/api` (Fastify, 14 integration tests), `apps/worker`.
- The full 25-step demo runs headlessly through the real services in ~35 s: `Platform.demo.perform(actor, 25)`; over HTTP: `POST /api/demo/steps/25/perform` (reviewer session). `npx tsx scripts/demo-verify.ts` asserts the headline results.
- Real server: `PORT=4747 npx tsx apps/api/src/main.ts` (health, login, system verified with curl).

## In progress / next

1. **Web UI** (`apps/web`) is being built by background agents (uncommitted working-tree changes until each reports): `ui-foundation` (shell, primitives, API hooks, presenter bar, Home/Login/Settings/Governance, `scripts/shot.mjs`), `viz-core` (`src/viz/**`: ForgeGraph, ReflexGlyph), and three page agents using the shared brief in the session `files/wave2-common.md`: `run-console` (Run, Traces), `learn-reflexes` (Learn, Reflexes, Shadow), `economics-drift` (Economics, Drift). Design brief: [DESIGN_SYSTEM.md](./DESIGN_SYSTEM.md). API contract: `packages/schemas/src/api.ts` + `apps/api/src/routes/*.ts`. **If the session resets**: `git status` shows which `apps/web` files exist; review them, run `npx tsc -p apps/web/tsconfig.json --noEmit`, and finish any page still rendering `PageStub`.
2. Dev data snapshots for UI work live in `/tmp/bf-snapshots/<stage>/bigforge.db` (stages `fresh`, `learned`, `validated`, `promoted`, `killer`, `drifted`, `complete`; temporary, regenerate by seeding a server: `POST /api/demo/seed {"stage":"complete"}` as `grace@acme.test` with `X-BigForge-Client: web`). The seeded Reflex approval in these older snapshots is attributed to Grace; current code records seeded approvals as a simulated system approval.
3. Still to do after the UI lands: wire the production-mode guard in the UI (hide the presenter and demo actions when `GET /api/auth/me` reports `mode: production`; the demo endpoints 404 there), Playwright critical-flow + accessibility e2e (config and `e2e/bundle.spec.ts` exist; browsers via `npx playwright install chromium`), visual validation, container build with the real UI, README (original moved to `docs/VISION.md`) with real screenshots and the demo guide, release gate, push.

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
