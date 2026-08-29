# E2E tests (Playwright)

Real-browser end-to-end specs over the React Flow diagram canvas at
`/editor` (the unauthenticated `AnonymousEditor` surface — no Supabase
session needed, no DB, just localStorage). Config: `playwright.config.ts`
(repo root). Specs/helpers: `_tests/e2e/`.

## Running

```sh
npm run test:e2e          # headless, all three browser projects
npm run test:e2e:ui       # Playwright's interactive UI mode
npm run test:e2e:report   # open the last HTML report
npx playwright test --project=chromium              # one browser
npx playwright test point-selection.spec.ts          # one file
npx playwright test point-selection.spec.ts -g "DOT" # one case
```

Nothing needs to be installed or running by hand first — `npm run test:e2e`
boots its own dev server (see "Dedicated port" below) and installs no
runtime dependency (browsers are a one-time `npx playwright install`, not a
per-run step). If browsers aren't installed yet:

```sh
npx playwright install chromium firefox webkit
```

## Dedicated port (3210)

`playwright.config.ts`'s `webServer` runs `next dev -p 3210`, NOT the
default `npm run dev` (port 3000, or 3456 per this repo's own convention —
see the root `CLAUDE.md`). This is deliberate: a developer usually already
has their own dev server running on their usual port, and the E2E run must
never fight it for the port or accidentally test against someone else's
half-finished edit. `reuseExistingServer: !process.env.CI` means a *second*
`next dev -p 3210` already running locally (e.g. left over from a previous
Playwright run) is reused instead of relaunched; CI always starts fresh.

Runs the DEV server, not a production build, even in CI: `npm run build`
shells out to `scripts/vercel-prebuild.sh`, which needs the private
`vendor/Admination.02-Design` git submodule. That's already checked out on
a dev machine, but CI would need `ADMINATION_DS_TOKEN` wired up just to
`next build` — the dev server sidesteps that fragility while still
exercising real app code (not a mock).

## The selection oracle

There is no dedicated "what's selected" test hook. The tests instead read
the **toolbar's Name field** — the one already-existing, user-visible
surface that reports the current selection:

- Nothing selected → the input's `placeholder` is
  `"Select a form, point, or line"`.
- A point selected → `placeholder` is the point's own id (e.g. `"P3"`).
- A form selected (or a form's **identity-centre** point — the form IS the
  point there) → `placeholder` is the form's id (e.g. `"F1"`), and `value`
  is the form's name.
- 2+ points selected → `placeholder` is `"N points"`.

**Testability gap:** the Name field only exists in the DOM while the
toolbar's "Name" category is open — `SecondToolbar` renders exactly one
category's content at a time (Shape rail / Color rail / Name field /
Rotation / Scale), there's no always-visible status readout. Every oracle
helper (`expectPointSelected`, `expectFormSelected`, `expectNothingSelected`,
`renameSelected` in `helpers/canvas.ts`) opens the "Name" category first as
a read-only side effect before asserting. This works, but a small,
always-rendered `data-testid="selection-status"` element (or similar) would
be a nicer, non-toggling oracle for whoever owns `components/` next — noted
here rather than added, since this ticket's write set excludes
`components/`/`app/`/`lib/`.

## The hover indicator selector

`FormNode.tsx`'s point-creation hover indicator (`RegionOverlay`) and
whole-form hover indicator (`CenterOverlay`) are both plain, class-less
`<div>`s with no `data-testid` — their only distinguishing trait is an
inline `background: var(--color-hover)` style (kept literally in the DOM's
`style` attribute, since it's a CSS custom property). `hoverIndicator(page,
nodeId)` in `helpers/canvas.ts` matches on that, scoped to the node under
test. It cannot tell a corner/side region hover apart from a centre-zone
hover by this alone (both render through the same color) — `hover.spec.ts`
only asserts "some indicator is showing," which is what it needs.

## Known-red-on-baseline: `point-selection.spec.ts` case (e) only

The ticket that commissioned this suite assumed clicking a point's dot (or
label) was broadly broken on this baseline (commit `952eb6f`, "WIP:
geometric click-resolver (`existingPointAtClient`) shared by click paths").
**Verified against the real baseline (each case run 3+ times, cross-checked
on Chromium/Firefox/WebKit): that turned out to be narrower than assumed.**
Only ONE case is actually broken:

- **`point-selection.spec.ts` — "(e) the identity centre dot selects the
  FORM"** — clicking the identity-CENTRE point's dot (`center:0`) leaves the
  form unselected (no `.selected` class, oracle still shows "Select a form,
  point, or line") instead of selecting the form. 100% reproducible, all
  three browsers.

Every OTHER dot-click, label-click, and Cmd/Ctrl-click-accumulate case —
for ordinary corner/side/apex points, across all four shapes, at 1×, ~0.5×,
~2× zoom, and after panning — **already works correctly** on this baseline.
It turns out there are actually TWO independent click-to-select code paths
in `FormNode`/`Canvas.tsx`: `PointVisual`'s own `Handle onClick` (wired to
`FormNode.tsx`'s `selectPoint`) fires on a genuine zero-movement click and
already worked before this ticket; `Canvas.tsx`'s `onConnectEnd`-based
`existingPointAtClient` resolver (the WIP mentioned in the commit message)
is a SEPARATE mechanism that apparently only actually gets exercised for
the identity-centre spot's click path (not confirmed by reading — inferred
from the fact that identity-centre is the one case that stays broken while
the mechanism that covers every other point kind works). Point this out to
whoever picks up the parallel fixing task: the fix is narrower than the
ticket assumed.

`point-selection.spec.ts` keeps cases (a)-(d) for every point kind anyway,
as the regression suite for that eventual fix — they're expected to STAY
green; a case going red there later is real signal, not something to wave
away as "expected." Only case (e) is the one RED case to expect right now.
`zoom.spec.ts`'s three cases are, likewise, all expected to PASS (they
repeat an ordinary-point dot-click, not the identity-centre one).

**Reading a failure:** a genuinely-red assertion here fails on
`expectPointSelected`/`expectFormSelected` timing out waiting for the
oracle's `placeholder`/`value` to match — Playwright's actionability
retries the whole `expect(...).toHave...()` for ~5s, then reports the last
observed value in the diff — not on a *locator* timeout while resolving a
selector (`page.locator(...).boundingBox()` returning null, a `waitFor`
never resolving). The former means "the app really did leave the wrong
thing selected." The latter means the TEST is broken (wrong selector, wrong
timing) and should be treated as an infrastructure bug in this suite, not
evidence about the app.

## Testability / infra findings from writing this suite

A few non-obvious things this suite had to work around, worth knowing if
you're debugging a red run or extending these specs:

- **Point labels are hidden by default.** `pointsVisible` starts `false` in
  the store (`state/store.ts`) — plain in-memory UI state, not a persisted
  preference — so `.point-label` (which `[data-point-id]` lives on) is
  `display:none` on every fresh load (`globals.css`'s `.points-hidden`
  rule). `gotoFreshEditor` clicks "Show point names" once per test to work
  around this; if you bypass `gotoFreshEditor` you'll get "element is not
  visible" trying to click a label.
- **A fraction of exactly 0 or 1 (every corner/apex spot) sits ON the
  node's CSS boundary pixel**, which is inside-vs-outside ambiguous for hit
  -testing — observed live: an unadjusted click on a square's `corner-tr`
  sometimes fell through to the PANE behind the node and fired the pane's
  own double-click-creates-a-shape handler, spawning an unrelated second
  form instead of a point. `fractionPoint()` (`helpers/canvas.ts`) insets
  every fraction-to-pixel conversion 2px in from the node's true edge to
  stay reliably inside it — well within every spot's own ~13px hit radius.
- **Cmd/Ctrl-click multi-select must hold `Meta`, not `Control`, even
  though the app accepts either.** On macOS, Control+left-click is the
  OS-level secondary-click (context-menu) gesture — confirmed live with a
  native-event listener: Chromium fires a `mousedown` with `ctrlKey:true`
  for it but NO following `click` event at all, so the app's own
  `event.ctrlKey` check is simply never reached, no matter how correct it
  is. `Meta` (⌘ on macOS, the Windows key elsewhere) has no such
  reinterpretation and produces a normal click with `metaKey:true`
  everywhere. `clickPointDot(..., { ctrl: true })` holds `Meta` for exactly
  this reason — the option name refers to the app-level affordance, not the
  literal key.
- **WebKit-only: `zoom.spec.ts`'s two wheel-zoom cases are unreliable.**
  Both `page.mouse.wheel()` and a synthetic `dispatchEvent(new
  WheelEvent(...))` (what `zoomToApprox` uses, since `mouse.wheel` had NO
  effect on WebKit at all) reach d3-zoom's handler on WebKit (confirmed:
  `preventDefault()` fires every time) but the net scale after the whole
  loop stays at 1 regardless of pacing between dispatches. Same code
  reliably reaches target on Chromium and Firefox. This reads as a real
  fidelity gap in Playwright's WebKit wheel-gesture simulation, not a bug
  in `zoomToApprox`'s own logic — `zoom.spec.ts`'s third case (pan, no
  wheel involved) passes on all three engines, so the underlying "does a
  dot-click still resolve correctly after the view transform changes"
  concern IS covered on WebKit, just not via the zoom path specifically.

## Realtime

The editor has Supabase Realtime (`postgres_changes`) wiring for live sync:
a sidebar that reflects INSERT/UPDATE/DELETE on `public.diagrams` from
other clients within the same organization
(`lib/realtime/use-diagrams-channel.ts`, wired in `EditorSidebar.tsx`), and
content sync for the currently-open diagram so an external write (another
tab, another member, or the MCP server) hydrates the canvas in place
(`lib/realtime/use-diagram-content-channel.ts`, wired inside `useAutosave` —
`components/editor/persist/save.ts`).

Two things worth knowing if you're debugging this area:

- **The publication SQL must be applied for any event to flow.**
  `prisma/sql/03-realtime.sql` adds `public.diagrams` to the
  `supabase_realtime` publication; a DB that hasn't had it applied emits no
  `postgres_changes` events at all for this table (the subscribe calls
  themselves still succeed — they just never fire). Like the rest of
  `prisma/sql/`, it's hand-applied via `psql`, not run by this test suite.
- **This suite does not exercise Realtime.** Every spec here runs against
  the unauthenticated `AnonymousEditor` (see the top of this file) — no
  Supabase session, no organization, `diagramId` is always `null`. That is
  exactly the condition under which every realtime hook in `lib/realtime/`
  no-ops (checked via `lib/supabase/env.ts`'s `supabaseConfigured()`), so a
  green run here is evidence the realtime code is inert with no env/session,
  not evidence that live sync itself works. There is no authenticated,
  two-client E2E coverage for the INSERT/UPDATE/DELETE sidebar sync, the
  content-sync hydration, or the autosave write-loop guard — that needs a
  real Supabase project (the publication SQL applied, two authenticated
  sessions in the same org) and is presently verified manually.

## CI secret requirement

`.github/workflows/e2e.yml` checks out `submodules: recursive` using
`secrets.ADMINATION_DS_TOKEN` if present (falls back to a plain checkout
otherwise, which is fine since the E2E webServer runs `next dev`, not
`next build` — no code path in the dev server touches
`admination-design-system`). If a future change makes the E2E workflow run
a production build instead, `ADMINATION_DS_TOKEN` becomes required, not
optional — see `scripts/vercel-prebuild.sh` and the root `CLAUDE.md`'s
"Tooling quirks" section for why.

## Hermeticity

Every spec calls `gotoFreshEditor(page)` in a `beforeEach` — it navigates
to `/editor`, clears every localStorage key this app writes (the diagram
draft plus the toolbar's persisted tool-selection prefs), and reloads, so
each test starts from a genuinely blank canvas with the default "shape"
category active. Playwright already gives each test its own browser
context (so this is largely redundant across tests), but it also protects
a test against state IT ITSELF left in localStorage via an earlier
`page.goto` within the same test.

## Files

- `helpers/canvas.ts` — the `CanvasDriver`-shaped helper module: navigation,
  toolbar plumbing, shape/point creation, the selection oracle, drag
  helpers, zoom/pan, and the hover-indicator selector. Every geometry
  fraction used to target a click (corners, side midpoints, the triangle's
  apex, etc.) is documented inline against `components/editor/domain/forms.ts`'s
  own constants.
- `smoke.spec.ts` — route loads, pane renders, create/select/deselect.
- `point-creation.spec.ts` — double-click creates a point at every
  addressable spot/side, per shape; capacity-1 reuse on repeat double-click.
- `point-selection.spec.ts` — **the regression suite** (see above).
- `wires.spec.ts` — drag-to-connect, click-without-drag is a no-op, drag to
  empty canvas auto-creates a carrier node.
- `hover.spec.ts` — the point-creation region hover indicator, approached
  from outside and inside the form.
- `zoom.spec.ts` — the dot-click selection check at ~0.5×/~2× zoom and
  after a pan.
