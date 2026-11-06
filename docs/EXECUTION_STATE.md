# BigForge Execution State

> Resume file. If the Copilot session, VM, or context resets, start here.
> Update this after every meaningful milestone (timestamp, branch, commit, validation, blocker, next command).

## Snapshot

| Field | Value |
|---|---|
| Last updated (UTC) | 2026-11-06T07:40Z |
| Branch | `main` |
| Remote | `origin` → `https://github.com/snowjug/BigForge.git` (confirmed) |
| Base commit | `a879b60` docs: define BigForge proof-of-concept vision |
| Working commit | _(see `git log -1`; updated at each checkpoint)_ |
| Active milestone | **M0 → M1** (foundation, then walking skeleton) |
| Classification target | HACKATHON-READY |

## Immediate next action

Build the engine bottom-up in vertical slices: `packages/schemas` → `packages/security` → `synthetic-labs/monorepo-build` (forge-ci tool + generator) → `packages/providers` (deterministic provider) → `packages/core` → `packages/platform` + `apps/api` → `apps/web`.

Exact next command: `npm run typecheck && npm test`

## Environment (detected 2026-11-06)

| Tool | Version | Notes |
|---|---|---|
| Node | 24.22.2 | `node:sqlite` works without flags (SQLite 3.53.4) |
| npm | 11.19.1 | npm workspaces; no pnpm/yarn installed |
| TypeScript | 6.0.3 | pinned `~6.0` because `typescript-eslint` supports `<6.1.0` (TS 7 is current but unsupported by lint tooling) |
| Vite / Vitest / ESLint | 8.3.6 / 5.1.0 / 10.14.0 | |
| Docker | 29.1.3 | usable for container build validation |
| Azure CLI / Bicep | 2.92.0 / 0.48.1 | logged in; **no resources provisioned** (see AZURE docs) |
| gh | 2.103.3 | active account has READ-only on this repo; see "Delivery blockers" |
| Playwright browsers | chromium-1248 cached | `~/.cache/ms-playwright` |
| tmux | session `bigforge` exists | |

Machine: Linux (swarm-dev), 4 vCPU, 15 GiB RAM, ~94 GiB free disk.

## Milestones

| # | Milestone | State |
|---|---|---|
| 0 | Repository and execution safety | in progress |
| 1 | Walking skeleton | pending |
| 2 | Core BigForge engine | pending |
| 3 | Complete 25-step demo story | pending |
| 4 | Premium product experience | pending |
| 5 | Visual validation loop | pending |
| 6 | Security and governance | pending |
| 7 | Testing and hardening | pending |
| 8 | Azure readiness | pending |
| 9 | Documentation and submission | pending |

## Validation state

See [VALIDATION_LEDGER.md](./VALIDATION_LEDGER.md). Nothing is claimed as passing unless it appears there with a date and command.

## Known failures / blockers

- **Delivery blocker (to resolve at release):** the active `gh` identity (`t-atshukla_microsoft`) has `READ` permission on `snowjug/BigForge`; pushing to `origin/main` needs a credential with write access. Intermediate work is committed locally only.

## Resume instructions

1. `cd ~/work/BigForge && git status && git log --oneline -5`
2. Read this file, [DECISIONS.md](./DECISIONS.md), [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).
3. `npm install` (only if `node_modules` is missing), then `npm run typecheck && npm test`.
4. Continue at the active milestone above.
