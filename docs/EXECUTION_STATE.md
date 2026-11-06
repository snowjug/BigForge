# BigForge Execution State

> Resume file. If the Copilot session, the VM or the context resets, start here.

## Snapshot

| Field | Value |
|---|---|
| Last updated (UTC) | 2026-11-06 |
| Branch | `main` (delivered to `origin/main`; see the delivery notes at the end of this file for the confirmed commit) |
| Remote | `origin` → `https://github.com/snowjug/BigForge.git` (public; `main` is not protected) |
| Base commit | `a879b60` docs: define BigForge proof-of-concept vision (the repository was README-only) |
| Classification | **HACKATHON-READY** (not a production candidate: nothing is deployed, the live provider is stub-validated only) |
| Active milestone | none: all milestones delivered; only the owner actions below remain |

## What exists and works

Everything below is validated; the evidence, with commands, is in [VALIDATION_LEDGER.md](./VALIDATION_LEDGER.md).

- **Engine**: `packages/schemas`, `security`, `providers`, `core` (recorder, baseline agent loop, compiler, executor, Token Firewall, drift, economics), `platform` (SQLite, services, 25-step demo director, audit hash chain), `observability`, `synthetic-labs/monorepo-build` (the `forge-ci` toolchain, 18 scenarios, operator pack, verifier).
- **Servers**: `apps/api` (Fastify: auth, RBAC, CSRF, helmet CSP, tenant isolation) and `apps/worker` (optional external job runner).
- **Web app**: `apps/web` (React 19): shell, presenter bar, Forge Floor, Run Console, Traces, Learn, Reflexes, Shadow, Drift, Economics, Governance, Settings, and the signature visualizations (Forge Graph, Uncertainty Lens, Reflex DNA, baseline-vs-Reflex lanes, drift fracture).
- **Delivery assets**: `Dockerfile`, `infra/**` (Bicep), `.github/workflows/{ci,deploy-azure}.yml`, `scripts/azure-*.sh`.
- **Docs**: README, `docs/` (architecture, formats, metrics, security, Azure, design system, decisions, validation ledger, known limitations, demo guide, judge Q&A, original vision).

## Run and verify

```bash
npm install
npm run demo                 # http://127.0.0.1:4747; sign in as grace@acme.test / forge-demo, "Start guided demo"
npm run demo:verify          # headless, all 25 steps over the real HTTP API
npm run validate             # prettier, eslint, strict tsc, vitest, production build
npm run test:e2e             # Playwright against the production bundle (npx playwright install chromium once)
E2E_BASE_URL=http://127.0.0.1:4747 npm run test:e2e   # the same suite against a running container
npm run scan:secrets && npm run audit:deps
npm run screenshots          # regenerates docs/screenshots from the running product (needs a build)
docker build -t bigforge . && docker run --rm -p 4747:4747 bigforge
```

## Manual actions that only the owner can do

1. **Choose a license.** `package.json` says `UNLICENSED` and the README says all rights are reserved. This is a decision for the repository owner; no license file was added.
2. **Azure is authored, not deployed.** To go further: sign in with `az login`, run `scripts/azure-whatif.sh` (read-only), review it, then deploy through the guarded `deploy-azure.yml` workflow or `scripts/azure-deploy.sh` after configuring GitHub OIDC (see [AZURE.md](./AZURE.md), "Deploy only with explicit authorization" and "GitHub OIDC setup"). Record the outcome in the ledger. Nothing was created, changed or what-if'd in any subscription.
3. **Live provider.** Azure OpenAI / OpenAI-compatible mode is validated against a local protocol stub only. A smoke test with a real endpoint is the next evidence to gather.
4. **GitHub Actions.** `ci.yml` passed on GitHub for the delivery push (see the delivery notes below). `deploy-azure.yml` has never been run and is manual by design.

## Known limitations

See [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md). In short: synthetic lab and scripted model, one task family, application-level containment (no OS sandbox), single node SQLite, Azure and live provider not validated in the cloud.

## Environment (detected 2026-11-06)

| Tool | Version | Notes |
|---|---|---|
| Node | 24.22.2 | `node:sqlite` works without flags (SQLite 3.53.4) |
| npm | 11.19.1 | npm workspaces |
| TypeScript | 6.0.3 | pinned `~6.0` (typescript-eslint supports `<6.1.0`) |
| Vite / Vitest / ESLint | 8.3.6 / 5.1.0 / 10.14.0 | |
| Playwright | 1.65 | Chromium 1254 cached in `~/.cache/ms-playwright` |
| Docker | 29.1.3 | legacy builder (no buildx): do not pass `--progress` |
| Azure CLI / Bicep | 2.92.0 / 0.48.1 | logged in; **nothing provisioned** |

The machine is shared and has 4 vCPUs, so full runs are slow: `npm run validate` took about 7 minutes under load.

## Delivery notes

| Field | Value |
|---|---|
| Delivery | `git push origin main` on 2026-11-06: a fast-forward from `a879b60` to `3719973`, no force |
| Last code change | `5af387b` (the commits after it change documentation only) |
| Remote confirmed | `git ls-remote origin refs/heads/main` matched the local `HEAD`, and `gh api repos/snowjug/BigForge/commits/main` returned the same SHA |
| GitHub Actions | [run 42232199625](https://github.com/snowjug/BigForge/actions/runs/42232199625) on `3719973`: validate, container, bicep and e2e jobs all succeeded |
| Backup branch | `origin/delivery/wip` holds an earlier snapshot (`af65d13`); it can be deleted |
| Repository metadata | description and topics were set with `gh repo edit` |

## Resume instructions

1. `cd ~/work/BigForge && git status && git log --oneline -5`
2. Read this file, [DECISIONS.md](./DECISIONS.md) and [KNOWN_LIMITATIONS.md](./KNOWN_LIMITATIONS.md).
3. `npm install` if `node_modules` is missing, then `npm run validate`.
4. Notes for agents: edit files with the editor tools; stop servers by explicit PID; never force-push; no paid Azure provisioning without explicit authorization.
