# Web app conventions

Read this before adding or changing a page. It is the contract between the foundation (shell, API layer,
UI kit, guided demo) and the signature pages. The design brief is `docs/DESIGN_SYSTEM.md` and is binding.

## 1. Routes and query strings

Build every URL with the helpers in `src/routes.ts` and read ids with the hooks in `src/routeParams.ts`.
Never hand-write a path.

| Page        | URL                                               | Helper                    | Read with                            |
| ----------- | ------------------------------------------------- | ------------------------- | ------------------------------------ |
| Forge Floor | `/`                                               | `homePath()`              |                                      |
| Sign in     | `/login?next=<in-app path>`                       | `loginPath(next)`         | `parseLoginParams`                   |
| Run Console | `/run?task=<taskId>&run=<runId>`                  | `runPath({ task, run })`  | `useRunParams()`                     |
| Traces      | `/traces`                                         | `tracesPath()`            |                                      |
| Trace       | `/traces/:runId`                                  | `tracePath(runId)`        | `useParams<{ runId: string }>()`     |
| Learn       | `/learn?family=<familyId>`                        | `learnPath({ family })`   | `useLearnParams()`                   |
| Reflexes    | `/reflexes`                                       | `reflexesPath()`          |                                      |
| Reflex      | `/reflexes/:versionId`                            | `reflexPath(versionId)`   | `useParams<{ versionId: string }>()` |
| Shadow      | `/shadow?version=<versionId>`                     | `shadowPath({ version })` | `useShadowParams()`                  |
| Economics   | `/economics`                                      | `economicsPath()`         |                                      |
| Drift       | `/drift?version=<versionId>`                      | `driftPath({ version })`  | `useDriftParams()`                   |
| Governance  | `/governance?tab=audit\|approvals\|roles\|safety` | `governancePath({ tab })` | `useGovernanceParams()`              |
| Settings    | `/settings`                                       | `settingsPath()`          |                                      |

Rules:

- Ids are optional. A page must render something useful without them (a list, a picker, or the most
  relevant record) and must treat an id that does not exist as an error state with a way back, not a crash.
- Selection is not navigation: use the setters returned by the hooks (`setParams({ task, run })`,
  `setFamily`, `setVersion`, `setTab`), which replace the history entry and keep the other parameters.
- `next` on `/login` only accepts in-app paths (`safeNext`).

### Adding a page

1. The route already exists. Replace the body of `src/pages/<Name>Page.tsx` (keep the default export).
   Stubs render `PageStub`; delete that import when you replace it.
2. Wrap the page in `<Page title="...">` (sets the document title and canvas padding) and lead with
   `<PageHeader title question actions />`: the question comes from `src/pages/pageMeta.ts` (design brief).
3. Put page-only CSS in `src/styles/<area>.css` and import it from the page module so it is code-split.
   Prefix classes with the area (`run-`, `trace-`, `learn-`, `reflex-`, `shadow-`, `econ-`, `drift-`).
   Reuse the `bf-` classes and the `--*` tokens; never hard-code a colour.
4. Every page needs loading (skeleton), empty (what to do next) and error (retry) states. `DataTable`,
   `ErrorState` and `EmptyState` provide them.

## 2. Talking to the API

All requests go through `src/api/client.ts` (`http.get/post/put`): JSON only, `X-BigForge-Client: web`,
`credentials: 'same-origin'`, errors parsed into `ApiError` (`status`, `code`, `message`, `details`,
`isForbidden`). Wire types come from `@bigforge/schemas` (`import type` only; the web bundle must not
include zod). `ApiError` is the default error type of every query and mutation.

- There is exactly one hook per endpoint in `src/api/hooks.ts` (`useReflexVersion(id)`, `useEconomics({ executions,
conservative })`, `useStartShadow()` ...). Query keys live in `src/api/keys.ts`.
- Ids may be `null` while a page resolves them: the query is then disabled.
- Lists are cursor paged. Use `useInfiniteAudit` / `useInfiniteRuns` / `useInfiniteTasks` /
  `useInfiniteComparisons` with `flattenPages(data)` and a "Load more" button (`fetchNextPage`).
- Mutations never retry and invalidate the narrowest keys they can change (the awaited promise keeps
  `isPending` true until fresh data has arrived). Do not call `invalidateQueries` yourself after a hook did.
- Long work is a job: `useStartShadow`, `useStartCanary` and `useProposeMutation` return `{ job }`.
  Follow it with `useJob(job.id)`; it polls until `succeeded`/`failed`, stops, and refreshes everything
  the job could have changed. Show `job.progress` (`done`, `total`, `label`).
- A 401 anywhere signs the user out (the auth gate redirects). A 403 means the role may not do it:
  show the server message, and disable the control with a reason beforehand using `useAuth().can(action)`
  (`src/auth/rbac.ts` mirrors the server's role table).
- `GET /api/reflexes/versions/:id` returns `actions` (`promote`, `rollback`, ...) for the current user:
  prefer those flags over deriving permissions yourself.

## 3. UI kit (`import { ... } from '../ui'`)

| Component                                               | Key props                                                                                                                                                                   |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Button`                                                | `variant` primary / ghost / danger / forge, `size`, `loading`, `disabledReason`, `icon`, `iconRight`, `block`                                                               |
| `ButtonLink`                                            | Button styling for a router `to`                                                                                                                                            |
| `Panel`                                                 | `title`, `subtitle`, `actions`, `variant` default / dense / flush, `as`, `headingLevel`, `footer`                                                                           |
| `Chip`                                                  | `tone`, `variant` soft / outline / solid, `icon`, `dashed`, `mono`, `size`                                                                                                  |
| `StatusChip`, `VerificationChip`, `RoleBadge`, `Avatar` | Reflex lifecycle, run verification, role, initials                                                                                                                          |
| `Provenance`                                            | `kind` (one or several), `metric` (id from `GET /api/metrics/definitions` adds definition + limitation)                                                                     |
| `Metric`                                                | `label`, `value`, `unit`, **`provenance` (required)**, `definition`, `delta`, `hint`, `size`, `tone`, `loading`                                                             |
| `DataTable<T>`                                          | `columns`, `rows`, `getRowId`, `caption`, `selectedId`, `onSelect`, `loading`, `error`, `onRetry`, `empty`, `footer`, `rowTone`, `maxHeight`                                |
| `Tabs` + `TabPanel`                                     | `label`, `items`, `value`, `onValueChange`, `idPrefix` (same prefix on both)                                                                                                |
| `Drawer`                                                | `open`, `onClose`, `title`, `description`, `footer`, `modal` (default true), `width`                                                                                        |
| `Tooltip`, `Popover`                                    | one focusable child; `Popover` takes `content` (node or `({ close }) => node`), `label`, `interactive`                                                                      |
| `Meter`, `Gauge`                                        | `value`, `min`, `max`, `label`, `valueText`, `threshold`, `tone`                                                                                                            |
| `Sparkline`                                             | `data`, `label`, `min`, `max`, `threshold`, `tone`, `area`                                                                                                                  |
| `Summary`                                               | `description`, `columns`, `rows`, `getRowId`: the text equivalent of a visualization                                                                                        |
| `Skeleton`, `SkeletonGroup`, `Spinner`                  | loading                                                                                                                                                                     |
| `EmptyState`, `ErrorState`                              | `title`, `description`, `action` / `error`, `onRetry`                                                                                                                       |
| `useToast()`                                            | `toast({ title, description, tone, action })`                                                                                                                               |
| `Field`, `Switch`                                       | form wiring: `<Field label help error>{(c) => <input className="bf-input" {...c} />}</Field>`                                                                               |
| `Page`, `PageHeader`, `Section`                         | page structure                                                                                                                                                              |
| `Kbd`, `ForgeLogo`, `VisuallyHidden`                    | small pieces                                                                                                                                                                |
| Formatters                                              | `formatTokens`, `formatUsd`, `formatMs`, `formatPct`, `formatDuration`, `formatMultiple`, `formatCount`, `shortHash`, `relativeTime(iso, now)`, `formatTimestamp`, `plural` |

Rules of the kit:

- **Provenance is not optional.** A measurement or estimate never appears without a `Provenance` badge
  (`Metric` enforces it). Composite figures pass every component kind: `provenance={['synthetic', 'estimated']}`.
  Never merge estimated and measured values into one unlabelled number. Take the kind from the data
  (`economics.perExecution.provenance`, `usage.tokenProvenance`, ...), never assume it.
- Colour is never the only signal: pair it with an icon, text or pattern (`StatusChip` and
  `VerificationChip` already do).
- Every visualization has a keyboard-reachable text equivalent: put a `Summary` next to it and give the
  SVG a meaningful `aria-label`.
- Disabled actions explain themselves: `disabledReason` keeps the button focusable and shows why.
- Time in render: call `useNow()` once and pass `now` to `relativeTime(iso, now)`; never call `Date.now()`
  in a component (the React Compiler lint rules forbid impure render).
- Motion: only to explain a state change. Read `useReducedMotion()` for JS-driven animation and make
  playback step-by-step when it is true; CSS animation is already neutralised by `base.css`.

## 4. Tokens and styling

`src/styles/tokens.css` holds every token for both themes. Accent convention: `--ember` (heat, tokens
spent), `--molten` (uncertainty boundary, the only persistent glow), `--steel` (forged, local work), `--jade`
(verified), `--crimson` (drift), `--teal` (replay-measured), `--amber` (estimated), `--ash` (raw).
Use `--x` for fills, strokes and glows and `--x-text` for text (it differs in the light theme). Set
`data-tone="jade"` on an element to get `--tone`, `--tone-text`, `--tone-tint`, `--tone-edge`.
`--glow-ember` and `--glow-molten` are for the active step only.

## 5. Shell, Forge strip and the guided demo

- The Forge strip lights the stage for the current route (`stagesForPath`). A page may claim stages while
  it is mounted: `useForgeStage(crossing ? ['escalate'] : ['execute'])`. While the presenter is open and
  the user is on the step's page, the step decides (`DEMO_STEP_STAGES`).
- `useDemo()` exposes the guided demo (`state`, `step`, `current`, `start`, `next`, `back`, `performCurrent`,
  `seed`, `reset`, `busy`, `activeJob`, `error`). The presenter navigates with `demoRoute(step, context)`
  (`src/demo/demoRoute.ts`), which maps the demo context ids onto the URLs above.
- Mark the region a demo step is about so the presenter can highlight and scroll to it:

  ```tsx
  const target = useDemoTarget('firewall'); // or ['recognized', 'known_steps']
  return <section {...target}>...</section>;
  ```

  The attribute is `data-demo-target="<stepId>"`; the hook adds `data-demo-active="true"` while that step
  is current. Step ids: `failure_enters`, `baseline_handles`, `trace_captured`, `variations`,
  `family_found`, `invariants`, `candidate`, `replay`, `shadow`, `compare`, `promote`, `new_task`,
  `recognized`, `known_steps`, `boundary`, `firewall`, `ai_resolves`, `continues`, `verified`,
  `comparison`, `env_change`, `canary`, `confidence_falls`, `back_to_shadow`, `mutation`.

- Actions a page offers (run baseline, compile, shadow, promote ...) should use the same hooks as the
  presenter, so the demo and the pages stay in step through the shared query cache.
- Production mode: `GET /api/auth/me` returns `mode`. In `production` the server has no `/api/demo*`
  endpoints, so `useDemo().available` is false, `open` is always false, the presenter, rail launcher and
  Home demo actions render nothing and no demo request is made. A page that shows demo-only UI should
  check `useDemo().available` (or `useAuth().isDemo`).
- Fast-forward follows the server: seeding needs `run_task`, and reaching `promoted` or beyond while the
  promotion is still pending needs `promote` (`seedBlockedReason` in `src/demo/scenes.ts`).
- Stable `data-testid`s (for end-to-end flows): `demo-presenter` (with `data-step`, `data-step-id`),
  `demo-title`, `demo-back`, `demo-action`, `demo-next`, `demo-restart`, `demo-presentation`,
  `demo-collapse`, `demo-exit`, `demo-progress`, `demo-rbac`, `demo-switch-reviewer`, `demo-error`,
  `rail-demo-toggle`, `start-demo`, `restart-demo`, `fast-forward`, `fast-forward-<stage>`, `reset-demo`,
  `reset-demo-confirm`, `theme-toggle`, `motion-toggle`, `identity-menu`, `identity-persona-<email>`,
  `sign-out`, `provider-chip`, `toolchain-chip`, `persona-<email>` (login), `login-email`,
  `login-password`, `login-submit`, `login-error`, `verify-chain`, `verify-chain-result`, `audit-filter`,
  `audit-load-more`, `safety-command`, `safety-evaluate`, `safety-preset-<id>`, `settings-save`,
  `settings-discard`.

## 6. Tests and review

- Pure logic (layout, parsing, formatting, derivations) lives in plain `.ts` and is tested with Vitest in
  `apps/web/test/*.test.ts` (node environment): `npx vitest run apps/web`.
- Look at what you build: `node scripts/shot.mjs --path /yourpage --matrix --out shots/yourpage` captures
  1440x900 and 390x844 in dark and light (`--axe` prints serious and critical accessibility violations,
  `--full` captures the whole scroll height, `--click`/`--keys` drive interactions).
