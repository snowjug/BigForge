# BigForge Design System: FORGED INTELLIGENCE

The interface of an original, funded AI developer-tool company. Craft over decoration: every visual encodes state. Do **not** imitate any existing product's layout, type, colour, assets or animation.

## The metaphor (every colour and motion maps to a meaning)

| Stage | Meaning | Visual language |
|---|---|---|
| Raw trace | Unprocessed agent behaviour | **ash**: cool neutral grays, dotted/dashed strokes, low contrast |
| Heat | Model reasoning, tokens spent, learning in progress | **ember** orange, warm glow only where tokens are actually spent |
| Forged pathway | Validated deterministic (local) work | **steel** blue-silver, crisp 1px bright edges, solid fills |
| Uncertainty boundary | The one decision a model must resolve | **molten** white-hot amber line; the only place a bright glow is allowed to persist |
| Verification | Evidence cools and locks the result | **jade** green with a "lock" cue (check + solid ring) |
| Drift | The world changed; trust cracks | **crimson** fracture lines, hairline cracks across the failing step |
| Mutation | A proposal reheats a Reflex for review | ember outline + "pending" dashes (never solid until approved) |

Rule: a glow means "something is active/uncertain right now". No permanent glowing borders, no gradient wallpapers, no glassmorphism everywhere, no bento-card grids, no template SaaS look.

## Tokens (CSS custom properties in `apps/web/src/styles/tokens.css`)

Dark is the default. Light is first class. Both must pass WCAG AA for text and UI components.

```
--bg:#0b0c0f  --bg-raised:#121317  --surface-1:#17191f  --surface-2:#1e2027  --surface-3:#272a33
--line:rgb(255 255 255/.08)  --line-strong:rgb(255 255 255/.16)
--text:#ece9e3  --text-dim:#a9a7a1  --text-faint:#8a8883   (faint must still be >= 4.5:1 on --bg)
--ember:#ff7a2e --ember-dim:#c95d1f --molten:#ffd08a --steel:#8fb4de --jade:#47d6a2 --crimson:#ff5468 --focus:#7cc4ff
light: --bg:#f5f2ec --bg-raised:#fbf9f5 --surface-1:#ffffff --surface-2:#f0ece4 --text:#1b1a18 --text-dim:#55524c
       accents darkened for contrast: --ember:#b34a0c --steel:#2c5f96 --jade:#0a7a54 --crimson:#c4223a --molten:#8a5a00
```
Radii: 4 (controls), 8 (panels), 999 (chips). Spacing: 4px base (4/8/12/16/24/32/48). Elevation by surface step + 1px line, not shadow soup. Use one soft shadow only for floating layers (drawers, menus, presenter bar).

## Typography (self-hosted via @fontsource-variable; the app must work offline)

- Display: **Bricolage Grotesque** variable (headings, hero numbers). Tight tracking (-0.02em), optical weight 600-700.
- UI: **Geist** variable (body, controls). 14px base, 1.5 line-height. Scale: 12 / 13 / 14 / 16 / 20 / 28 / 44 / 72.
- Data: **Geist Mono** variable for ids, hashes, commands, numbers in tables. `font-variant-numeric: tabular-nums` for all metrics.
- Uppercase micro-labels: 11px, 0.08em tracking, `--text-faint`. Never below 11px.

## Layout

- Left rail (icons + labels, 208px at >=1280px, 64px icon-only at 768-1279px, bottom tab bar below 768px).
- Top **Forge strip**: the loop *Observe, Fingerprint, Compile, Validate, Execute, Escalate, Evolve* as a thin segmented pipeline; the stage relevant to the current page glows ember; shows provider mode chip (`Deterministic provider · synthetic` or `Live provider`), toolchain chip (`forge-ci 1.4.2`), identity menu (persona switcher in demo mode), theme toggle.
- Main canvas uses **intentional density**: split views, timelines, inspectors, tables with sticky headers. Avoid uniform card grids. A right-hand **inspector drawer** shows details for the selected node/row.
- Responsive targets: 1440x900, 1920x1080, 1366x768, tablet (820x1180), mobile (390x844). Graphs scroll/zoom horizontally on small screens and always have a text summary.

## Mandatory component primitives (`apps/web/src/ui/`)

`Button` (primary/ghost/danger/forge; loading + disabled-with-reason tooltip), `Panel` (title, actions, dense/flush variants), `Chip`, `Provenance` badge, `Metric` (label, value, unit, provenance, delta, info popover from `GET /api/metrics/definitions`), `DataTable` (sticky head, keyboard row selection, empty/loading/error rows), `Tabs`, `Drawer`, `Tooltip`, `Meter`/`Gauge`, `Sparkline`, `Skeleton`, `EmptyState`, `ErrorState` (retry), `Toast` (aria-live), `Kbd`, `ForgeLogo`, `Spinner` (reduced-motion safe).

### Provenance badges (never show a number without one when it is a measurement or estimate)

`synthetic` (steel, solid outline) · `simulated` (ash, dashed) · `estimated` (amber, hatched) · `measured` (jade) · `replay-measured` (teal). Composite metrics show every component provenance. Tooltip = the definition from `/api/metrics/definitions` and its limitation.

## Signature experiences (all functional, data-driven, accessible)

1. **Forge Graph**: SVG DAG of a Reflex's steps (layered layout from `dependsOn`). Node = step, colour by `kind` (known=steel, validation=steel hollow, hybrid=steel with ember notch, boundary=molten, verification=jade). Click opens the inspector (why it ran, operator, rationale `replaces`/`conservation`/`baselineTokens`, permissions, guards). In run mode nodes light in execution order (ember while running, cooled steel when done, molten pulse at a boundary, jade when verification locks, crimson fracture on stop).
2. **Baseline vs Reflex synchronized execution**: two lanes on one shared time axis (virtual time = simulated model latency + measured local time; label it). Play/pause/scrub (keyboard: space, arrows, home/end). Live counters: model calls, tokens, cost, commands, elapsed. Baseline lane shows model-call blocks sized by tokens (ember) and tool calls; Reflex lane shows local steps (steel, zero height of ember) and the single boundary call.
3. **Token Flow**: Sankey (custom SVG): total baseline tokens split into cached/uncached input, output, per-step; BigForge: remaining boundary tokens vs avoided. Always `synthetic`/`estimated` labelled.
4. **Uncertainty Lens**: the Token Firewall in one picture: all evidence chunks observed (faded blob with sizes) vs the few selected (bright, inside a circular lens); verdict path chips (`REDUCE_CONTEXT > USE_SMALLER_MODEL > ALLOW`), the seven call-record questions with answers, rejected evidence with reasons, screening findings, the bounded call (model, tokens, tier) and the validated answer.
5. **Reflex DNA**: the compile alignment: rows = source traces, columns = aligned behaviours ordered by consensus; cell = present/absent; column header bar = conservation (invariant solid, variable hatched); bottom strand = compiled steps coloured by kind with height = baseline tokens replaced; operator chosen + alternatives. A compact helix/barcode **glyph** derived from the content hash identifies each Reflex everywhere (lists, headers).
6. **Cognitive Economics dashboard**: break-even chart (cumulative tokens: baseline line vs BigForge = investment + per-run; shaded interval), investment waterfall (shadow, canary, compile, replay, review, learning toggle), per-execution saving with basis label (measured reference vs counterfactual), CRR gauge beside verification pass rate, token ROI **and** cost ROI (cost can be negative: explain caching and the review-cost assumption), assumptions panel (projected executions slider, conservative toggle).
7. **Drift fracture**: the Forge Graph with a fracture drawn across the diverging step, agreement timeline (historic vs canary with threshold line), per-task canary result grid (agree/disagree, divergence step, stop reason), environment diff chip (`forge-ci 1.4.2 -> 1.5.0`), confidence gauge falling, lifecycle ribbon (Active -> Watch -> Shadow), and the mutation proposal as an ember-outlined diff (not activated).
8. **Guided presentation mode**: a bottom Presenter bar: step N/25, scene name, title, narration, `Back`, `Next`, `Restart`, `Exit`, the step's action button, progress rail by scene; keyboard `ArrowRight/ArrowLeft/Esc/R`. Optional large-type presentation layout that hides chrome. It navigates to the right view and highlights the relevant region. Works with no internet.

## Pages (combine where it improves usability)

| Route | Question answered | Decision | Evidence | Action |
|---|---|---|---|---|
| `/` Forge Floor | Where is the forge right now? | Start the guided demo or continue | live pipeline stage, key figures with provenance | Start Guided Demo, Reset |
| `/run` Run Console | What happens to this task? | Which path should it take? | task + CI log, match decision with gates, execution playback | Send failure, Run baseline/auto/compare |
| `/traces` | What did the agent actually do? | Is this trace safe to learn from? | trace timeline, tokens (synthetic), commands (measured), redactions, blocked actions | Inspect |
| `/learn` | What repeats? | Compile a Reflex? | families, matcher false-match rate, alignment/DNA | Discover, Compile |
| `/reflexes`, `/reflexes/:id` | Is this Reflex trustworthy and what does it do? | Promote, reject, roll back | steps (Forge Graph), permissions, gate, evidence, lifecycle, audit | Replay, Shadow, Promote (reviewer) |
| `/shadow` | Does it agree with the AI? | Eligible for promotion? | replay + shadow comparison table, gate checklist | Replay, Run Shadow Brain |
| `/economics` | Is it worth it? | Keep investing? | ROI, CRR, break-even with interval | Adjust assumptions |
| `/drift` | Is the world still the same? | Accept or reject a mutation | canary grid, agreement, fracture, mutation diff | Update tool, Run canary, Propose/Approve mutation |
| `/governance` | Who did what, and what is blocked? | Trust the system? | audit chain verification, approvals, command-safety playground, roles | Verify chain, Try a command |
| `/settings` | What is configured and what is real? | Change thresholds | provider honesty panel, gate/drift/economics settings | Save (admin), Reset demo (admin) |

Every page needs real loading (skeleton), empty (what to do next), and error (retry) states.

## Accessibility and motion (required)

- Keyboard: every control reachable, visible focus ring (`--focus`, 2px, offset 2px), skip link, logical order, no keyboard traps, drawer returns focus.
- Colour is never the only signal: pair with icon/text/pattern (e.g. agree = check, disagree = cross).
- Every visualization has an equivalent text summary or data table reachable by keyboard (`<details>` or a "View as table" toggle) and meaningful `aria-label`s; status changes use `aria-live="polite"`.
- `prefers-reduced-motion: reduce` disables looping animation, parallax and auto-play (playback becomes step-by-step); transitions shrink to <= 1ms. Provide an in-app motion toggle as well.
- Motion only explains state transitions (heat on active step, cooling on completion, crack on drift). No decorative loops.
- Contrast: run axe in Playwright for dark and light on every page; zero serious/critical violations.

## Data honesty in the UI

- Show provider mode in the Forge strip at all times. Deterministic activity is never called a "model call" without the word *deterministic/synthetic* nearby.
- Never mix estimated and measured values into one unlabeled figure.
- Pricing is an assumption with a timestamp; show it where cost appears.
- Azure: the UI must not claim anything is deployed.

## Engineering rules for the web app

React 19, TypeScript strict (no `any`), React Router, TanStack Query (retries off for mutations; invalidate after actions), no component library, hand-written CSS (tokens + CSS files per area), `lucide-react` icons, custom SVG for visualizations (no chart library). All requests go through `apps/web/src/api/client.ts` which sets `X-BigForge-Client: web`, `credentials: 'same-origin'`, and parses errors into `ApiError`. Types come from `@bigforge/schemas` (never import server packages). Layout algorithms and formatters are plain `.ts` with unit tests (Vitest, node environment).

## Corrections and additions from the foundation build

Refinements made while building `apps/web` (tokens in `apps/web/src/styles/tokens.css` are the source of truth; conventions for page authors are in `apps/web/src/routes.md`).

### Tokens

- `--text-faint` is **`#94928c`** in dark (was `#8a8883`) and **`#67635b`** in light, so faint text passes 4.5:1 on every surface step including `--surface-3`, not only on `--bg`. Light `--surface-3` is `#e6e1d6`.
- **Text-safe accents.** Accents are fills, strokes and glows. Text uses `--ember-text`, `--steel-text`, `--jade-text`, `--crimson-text`, `--molten-text`, `--teal-text`, `--amber-text`, `--ash-text`. In dark they equal the accent; in light they are darker (`#963a06`, `#285689`, `#07654a`, `#a81a2f`, `#734900`, `#086563`, `#734900`, `#565e6c`) so text on a tinted chip still reaches 4.5:1. `--ember-dim` is for fills and strokes only (4.2:1 as text on `--surface-1`).
- **New tokens.** `--teal` (replay-measured), `--amber` (estimated), `--ash` and `--ash-line` (raw traces, dashed strokes), `--line-control` (borders of inputs and toggles, at least 3:1 on every surface, WCAG 1.4.11), `--on-ember`/`--on-crimson`/`--on-jade` (text on solid fills), `--primary-bg`/`--primary-fg` (the high-contrast primary button), `--scrim`, `--shadow-float`.
- **Tone convention.** Every accent has `--x-tint` (13% mix) and `--x-edge` (55% mix). `data-tone="ember|molten|steel|jade|crimson|teal|amber|ash"` on any element exposes `--tone`, `--tone-text`, `--tone-tint`, `--tone-edge`. `--glow-ember` and `--glow-molten` are the only glows and belong to the active step or boundary.
- Type sizes are `rem` (12/13/14/16/20/28/44/72 px at the default root). The presentation layout raises the root to 112.5%.

### Components added beyond the mandatory list

`Field` and `Switch` (labelled form wiring, native `role="switch"`), `Page` / `PageHeader` / `Section` (every page leads with the question it answers), `Summary` (the `<details>` + table equivalent of any visualization), `StatusChip` (Reflex lifecycle), `VerificationChip`, `RoleBadge`, `Avatar`, `ButtonLink`, `Popover` (interactive or "toggletip" mode). `Provenance` draws the five kinds differently as well as in colour: measured = jade fill with a check, replay-measured = teal double rule, synthetic = steel solid outline, simulated = ash dashed, estimated = amber hatched.

### Layout and behaviour decisions

- The shell is a fixed-viewport grid (`100dvh`); `<main>` scrolls. The presenter bar is a grid row, not an overlay, so it never covers content. Toasts sit under the Forge strip, never over the presenter controls.
- Forge strip: at widths below 1700px the identity menu shows the avatar only, and when the pipeline is squeezed the stage numbers drop before the stage names. Below 768px the strip is two rows (brand + chips, then the pipeline with only the active label) and the rail becomes a bottom tab bar with four primary views plus "More".
- The Forge strip stage is resolved page override, then guided-demo step, then route (`src/stages.ts`), so the Escalate segment lights molten during the Token Firewall steps even though they share `/run` with execution.
- Drawers are modal by default (focus trap, inert page, Escape, focus returns to the opener) and become a bottom sheet below 768px; `modal={false}` docks an inspector beside the content.
- `/governance` uses `?tab=audit|approvals|roles|safety`. The roles matrix is a copy of the server's table (`apps/web/src/auth/rbac.ts`); the server remains the only enforcement.
