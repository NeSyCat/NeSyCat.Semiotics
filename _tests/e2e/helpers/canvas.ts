import { expect, type Page } from '@playwright/test'

// ── Domain vocabulary mirrored from components/editor/domain (read-only —
// this file must NOT import app source; see the ticket's WRITE SET fence).
// Keep these in sync by hand if the app's own geometry ever changes; a
// mismatch here surfaces immediately as a failing point-creation spec, not a
// silent drift.
export type Shape = 'triangle' | 'square' | 'circle' | 'rhombus' | 'empty'

const SHAPE_LABEL: Record<Shape, string> = {
  empty: 'Empty',
  triangle: 'Triangle',
  rhombus: 'Rhombus',
  circle: 'Circle',
  square: 'Square',
}

// One fixed-fraction ([0,1]² of the node's own unrotated bounding box) test
// spot per addressable edgeKey, per shape — derived from the geometry facts
// in domain/forms.ts (see the ticket's "Geometry facts" section, verified
// against the actual constants while writing this driver). A capacity-1
// "spot" key (corner/centre/apex) has ONE canonical point; a "side" key's
// fraction is just a spot inside that side's territory — the real click
// resolves via the app's own edgeAt, not by us claiming to know the exact
// eventual point position.
export const SQUARE_SPOTS: Record<string, [number, number]> = {
  'corner-tl': [0, 0],
  'corner-tr': [1, 0],
  'corner-br': [1, 1],
  'corner-bl': [0, 1],
  'center-up': [0.5, 0.25],
  'center-down': [0.5, 0.75],
  center: [0.5, 0.5],
}
export const SQUARE_SIDES: Record<string, [number, number]> = {
  top: [0.5, 0],
  right: [1, 0.5],
  bottom: [0.5, 1],
  left: [0, 0.5],
}

export const TRIANGLE_SPOTS: Record<string, [number, number]> = {
  peak: [1.0, 0.5],
  'corner-base-top': [0.25, 0.067],
  'corner-base-bottom': [0.25, 0.933],
  'center-up': [0.75, 0.5],
  center: [0.5, 0.5],
}
export const TRIANGLE_SIDES: Record<string, [number, number]> = {
  a: [0.625, 0.2835],
  b: [0.625, 0.7165],
  c: [0.25, 0.5],
}

export const RHOMBUS_SPOTS: Record<string, [number, number]> = {
  'corner-top': [0.5, 0],
  'corner-right': [1, 0.5],
  'corner-bottom': [0.5, 1],
  'corner-left': [0, 0.5],
  'center-up': [0.5, 0.25],
  'center-down': [0.5, 0.75],
  center: [0.5, 0.5],
}
export const RHOMBUS_SIDES: Record<string, [number, number]> = {
  'top-right': [0.75, 0.25],
  'bottom-right': [0.75, 0.75],
  'bottom-left': [0.25, 0.75],
  'top-left': [0.25, 0.25],
}

export const CIRCLE_SPOTS: Record<string, [number, number]> = {
  'center-up': [0.5, 0.25],
  'center-down': [0.5, 0.75],
  center: [0.5, 0.5],
}
export const CIRCLE_SIDES: Record<string, [number, number]> = {
  right: [1, 0.5],
  up: [0.5, 0],
  down: [0.5, 1],
  left: [0, 0.5],
}

// ── Navigation / hermetic reset ─────────────────────────────────────────

// Fresh, empty /editor: clears every localStorage key this app writes
// (the diagram draft AND the toolbar's persisted tool-selection prefs) so
// each test starts from a truly blank canvas with the default 'shape'
// category active, regardless of what a previous test in this worker left
// behind.
export async function gotoFreshEditor(page: Page): Promise<void> {
  await page.goto('/editor')
  await page.evaluate(() => {
    try {
      localStorage.clear()
    } catch {
      /* ignore */
    }
  })
  await page.reload()
  await page.locator('.react-flow__pane').waitFor({ state: 'visible' })
  // Point LABELS are hidden by default — `pointsVisible` starts `false` in
  // the store (components/editor/state/store.ts) and is plain in-memory UI
  // state, not a persisted preference, so this is true on every fresh load,
  // not just after gotoFreshEditor's own localStorage.clear(). `.point-label`
  // (globals.css's `.points-hidden .point-label { display: none !important }`)
  // covers a point's [data-point-id] label too, so any spec that reads or
  // clicks a label needs this on first. One click, once per test.
  const showPointNames = page.locator('button[title="Show point names"]')
  if ((await showPointNames.count()) > 0) await showPointNames.click()
}

// ── Toolbar plumbing ─────────────────────────────────────────────────────

const CATEGORY_LABEL: Record<string, string> = {
  shape: 'Shape',
  color: 'Color',
  name: 'Name',
  rotation: 'Rotation',
  scale: 'Scale',
  location: 'Location',
}

// Opens the given top-pill category (a no-op if it's already open) — the
// category pill toggles closed on a second click of the SAME key, so this
// checks `is-active` first rather than blindly clicking.
export async function ensureCategory(page: Page, key: keyof typeof CATEGORY_LABEL): Promise<void> {
  const btn = page.locator(`[role="toolbar"] button[title="${CATEGORY_LABEL[key]}"]`)
  const active = await btn.evaluate((el) => el.classList.contains('is-active'))
  if (!active) await btn.click()
}

// TESTABILITY GAP (see README): the selection-oracle name field only exists
// in the DOM while the toolbar's "Name" category is open (SecondToolbar
// renders exactly one category's content at a time) — there is no
// always-visible selection readout. Every oracle read below opens it first.
async function nameInput(page: Page) {
  await ensureCategory(page, 'name')
  return page.locator('.toolbar-second-pill input[type="text"]')
}

// Types the given value into the (currently selected target's) Name field —
// opens the 'name' category first, same as the oracle read path.
export async function renameSelected(page: Page, value: string): Promise<void> {
  const input = await nameInput(page)
  await input.fill(value)
}

export async function expectNothingSelected(page: Page): Promise<void> {
  const input = await nameInput(page)
  await expect(input).toHaveAttribute('placeholder', 'Select a form, point, or line')
}

// Point selected: placeholder is the point's own id, AND no React Flow node
// carries the `.selected` class (selection stayed on the point, not the
// form) — the two-part assertion the regression suite is built around.
export async function expectPointSelected(page: Page, pointId: string): Promise<void> {
  const input = await nameInput(page)
  await expect(input).toHaveAttribute('placeholder', pointId)
  await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
}

// Form (or a form's identity-centre point) selected: placeholder is the
// form's id, the form's node carries `.selected`, and — when given — the
// field's value is the form's name.
export async function expectFormSelected(page: Page, formId: string, formName?: string): Promise<void> {
  const input = await nameInput(page)
  await expect(input).toHaveAttribute('placeholder', formId)
  await expect(page.locator(`.react-flow__node[data-id="${formId}"]`)).toHaveClass(/\bselected\b/)
  if (formName !== undefined) await expect(input).toHaveValue(formName)
}

export async function selectedNodeIds(page: Page): Promise<string[]> {
  const ids = await page.locator('.react-flow__node.selected').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''))
  return ids.filter(Boolean)
}

// ── Shape rail / shape creation ──────────────────────────────────────────

// Picks a tile on the Shape rail (opens the 'shape' category first). With
// nothing selected this just sets the create-tool default (activeShape) —
// it does NOT create anything by itself.
export async function selectShapeTile(page: Page, shape: Shape): Promise<void> {
  await ensureCategory(page, 'shape')
  const label = SHAPE_LABEL[shape]
  await page.locator(`[role="group"][aria-label="Shape"] button[title^="${label}"]`).click()
}

async function allNodeIds(page: Page): Promise<string[]> {
  const ids = await page.locator('.react-flow__node').evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''))
  return ids.filter(Boolean)
}

// Double-click a blank spot on the canvas (viewport/client coordinates —
// NOT node-relative) to create a form of `shape`, returning its new
// `data-id`. Uses the app's own onPaneClick 350ms two-click detector, so the
// two clicks must land close together in time — a single mouse.click with
// clickCount:2 satisfies that.
export async function addShapeAt(page: Page, shape: Shape, point: { x: number; y: number }): Promise<string> {
  await selectShapeTile(page, shape)
  const before = new Set(await allNodeIds(page))
  await page.mouse.click(point.x, point.y, { clickCount: 2 })
  await expect
    .poll(async () => (await allNodeIds(page)).length, { message: 'waiting for a new form node to appear' })
    .toBeGreaterThan(before.size)
  const after = await allNodeIds(page)
  const created = after.find((id) => !before.has(id))
  if (!created) throw new Error('addShapeAt: no new node id found after double-click')
  return created
}

// Converts a node-fraction (fx, fy) into a viewport point, inset 2px in from
// the box's true edge on every side. A boundary-EXACT fraction (0 or 1 —
// every corner/apex spot in the constants above) maps to a pixel sitting
// exactly ON `.react-flow__node`'s CSS edge, which is inside-vs-outside
// ambiguous for hit-testing (observed live: a plain `box.x + 1*box.width`
// click on a square's corner-tr sometimes fell through to the PANE behind
// the node instead of the node itself, firing the pane's own
// double-click-creates-a-shape handler and spawning an unrelated second
// form instead of a point). 2px is far inside every spot's own hit radius
// (corner/apex discs are ~13px, side stripes wider still), so this can't
// drift the click onto a neighboring edgeKey.
function fractionPoint(box: { x: number; y: number; width: number; height: number }, fx: number, fy: number): { x: number; y: number } {
  const inset = 2
  const w = Math.max(box.width - inset * 2, 1)
  const h = Math.max(box.height - inset * 2, 1)
  return { x: box.x + inset + fx * w, y: box.y + inset + fy * h }
}

// ── Point creation ────────────────────────────────────────────────────────

async function realHandleIds(page: Page, nodeId: string): Promise<string[]> {
  const ids = await page
    .locator(`.react-flow__handle[data-nodeid="${nodeId}"]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-handleid') ?? ''))
  // Exclude the hover-only phantom handle ('phantom:<edgeKey>') — it can
  // appear/disappear purely from the cursor resting on the spot, unrelated
  // to whether a REAL point was created there.
  return [...new Set(ids.filter((id) => id && !id.startsWith('phantom:')))]
}

async function pointLabelIds(page: Page, nodeId: string): Promise<string[]> {
  const ids = await page
    .locator(`.react-flow__node[data-id="${nodeId}"] [data-point-id]`)
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-point-id') ?? ''))
  return [...new Set(ids.filter(Boolean))]
}

export interface AddedPoint {
  // The new handle id (`${edgeKey}:${index}`), or null if no new REAL handle
  // appeared — the expected outcome for a repeat double-click on an
  // already-full capacity-1 spot, which reuses the existing point instead of
  // creating a second one.
  handleId: string | null
  // The point's own domain id (its "P-id", read off its [data-point-id]
  // label) — null both when handleId is null AND for the identity-CENTRE
  // point specifically, whose label is suppressed by design (FormNode.tsx:
  // `suppressLabel={edgeKey === 'center'}` — it shares the form's own name
  // instead of carrying a separate one).
  pointId: string | null
}

// Double-clicks the form `nodeId` at fraction (fx, fy) of its own live
// (unrotated) bounding box to add a point there.
export async function addPointAt(page: Page, nodeId: string, fx: number, fy: number): Promise<AddedPoint> {
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`)
  const box = await node.boundingBox()
  if (!box) throw new Error(`addPointAt: node ${nodeId} has no bounding box`)
  const { x, y } = fractionPoint(box, fx, fy)
  const beforeHandles = new Set(await realHandleIds(page, nodeId))
  const beforeLabels = new Set(await pointLabelIds(page, nodeId))
  await page.mouse.click(x, y, { clickCount: 2 })
  // Bounded wait for a NEW real handle to show up. This bound doubles as
  // how a "no new point" case (a capacity-1 spot's repeat double-click) is
  // confirmed: if nothing shows up within the window, that's the steady
  // state, not an unsettled DOM — NOT `toBeGreaterThanOrEqual(before.size)`,
  // which is trivially already true before the click's effect ever lands
  // (handle count never DECREASES), so it would resolve on the very first
  // check and race the real mutation.
  try {
    await page.waitForFunction(
      ({ selector, before }) => {
        const els = Array.from(document.querySelectorAll(selector))
        const ids = els
          .map((e) => e.getAttribute('data-handleid') ?? '')
          .filter((id) => id && !id.startsWith('phantom:'))
        return ids.some((id) => !before.includes(id))
      },
      { selector: `.react-flow__handle[data-nodeid="${nodeId}"]`, before: [...beforeHandles] },
      { timeout: 3000 },
    )
  } catch {
    /* no new handle within the window — the legitimate steady state for a
       capacity-1 spot's repeat double-click; a caller that expected growth
       fails its own assertion on the returned (null) handleId instead. */
  }
  const afterHandles = await realHandleIds(page, nodeId)
  const afterLabels = await pointLabelIds(page, nodeId)
  return {
    handleId: afterHandles.find((id) => !beforeHandles.has(id)) ?? null,
    pointId: afterLabels.find((id) => !beforeLabels.has(id)) ?? null,
  }
}

export async function handleIds(page: Page, nodeId: string): Promise<string[]> {
  return realHandleIds(page, nodeId)
}

// Center (viewport coordinates) of a point's dot — the real, clickable
// handle — regardless of which of the two same-id Handle DOM nodes
// (source/target) `.first()` resolves to, since both sit at the identical
// anchor.
export async function handleCenter(page: Page, nodeId: string, handleId: string): Promise<{ x: number; y: number }> {
  const handle = page.locator(`.react-flow__handle[data-nodeid="${nodeId}"][data-handleid="${handleId}"]`).first()
  const box = await handle.boundingBox()
  if (!box) throw new Error(`handleCenter: handle ${nodeId}/${handleId} not found`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

// Fraction-of-node-box point, in current viewport coordinates — re-measures
// the node's LIVE bounding box every call so it stays correct across
// zoom/pan.
export async function nodeSpot(page: Page, nodeId: string, fx: number, fy: number): Promise<{ x: number; y: number }> {
  const box = await page.locator(`.react-flow__node[data-id="${nodeId}"]`).boundingBox()
  if (!box) throw new Error(`nodeSpot: node ${nodeId} has no bounding box`)
  return fractionPoint(box, fx, fy)
}

// Clicks a point's dot (its real handle) — a plain click (no movement)
// exercises the same click/drag resolver a user's mouse does. `ctrl: true`
// holds the multi-select accumulate modifier for the click — Canvas.tsx's
// multiSelectionKeyCode accepts EITHER 'Meta' or 'Control', and this
// deliberately holds 'Meta', not 'Control': on macOS, Control+left-click is
// the OS-level secondary-click (context-menu) gesture — Chromium never
// fires a native 'click' event for it at all (confirmed live: a 'mousedown'
// with ctrlKey:true lands, no 'click' follows), so the app's own
// `event.ctrlKey` check is simply never reached, on this one platform, no
// matter how correct it is. 'Meta' (⌘ on macOS, the Windows key elsewhere)
// has no such OS-level reinterpretation and produces a normal click with
// `metaKey: true` on every platform Playwright supports.
export async function clickPointDot(page: Page, nodeId: string, handleId: string, opts: { ctrl?: boolean } = {}): Promise<void> {
  const p = await handleCenter(page, nodeId, handleId)
  if (opts.ctrl) await page.keyboard.down('Meta')
  await page.mouse.click(p.x, p.y)
  if (opts.ctrl) await page.keyboard.up('Meta')
}

// Clicks a point's LABEL ([data-point-id]) — only present for a point with a
// non-empty rendered label (every point defaults to its own id as the label
// text, so this is always present right after creation).
export async function clickPointLabel(page: Page, pointId: string): Promise<void> {
  await page.locator(`[data-point-id="${pointId}"]`).click()
}

// ── Drag (stepped — React Flow's d3-drag needs intermediate moves to
// actually engage; a single teleporting mouse.move often doesn't) ─────────

export async function dragFromTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }, steps = 10): Promise<void> {
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  for (let i = 1; i <= steps; i++) {
    const t = i / steps
    await page.mouse.move(from.x + (to.x - from.x) * t, from.y + (to.y - from.y) * t)
  }
  await page.mouse.up()
}

export async function edgeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__edge').count()
}

export async function nodeCount(page: Page): Promise<number> {
  return page.locator('.react-flow__node').count()
}

// ── Selection / deselection helpers ──────────────────────────────────────

// A blank spot on the pane, far from any node — safe to click to deselect
// without risk of double-click-creating a new form (single click only).
export async function clickEmptyCanvas(page: Page, point: { x: number; y: number } = { x: 60, y: 500 }): Promise<void> {
  await page.mouse.click(point.x, point.y)
}

// ── Zoom / pan ─────────────────────────────────────────────────────────

export async function getZoom(page: Page): Promise<number> {
  const transform = await page.locator('.react-flow__viewport').evaluate((el) => (el as HTMLElement).style.transform)
  const m = transform.match(/scale\(([-\d.]+)\)/)
  return m ? parseFloat(m[1]) : 1
}

// Dispatches one synthetic ctrl-wheel event at (x, y) — used instead of
// Playwright's page.mouse.wheel() because that API's OS-level wheel
// emulation doesn't reliably reach React Flow's zoom handler under
// WebKit (observed live: identical code zooms correctly on Chromium/
// Firefox, stays at scale 1 every time on WebKit). A plain DOM
// `new WheelEvent(...)` dispatched at the target element is NOT
// `isTrusted`, but d3-zoom's own listener (what React Flow's zoom-on-
// scroll is built on) reads event properties, not trust — so this
// reaches the same code path a real trackpad ctrl+wheel does, on every
// engine Playwright drives.
async function dispatchWheel(page: Page, x: number, y: number, deltaY: number): Promise<void> {
  await page.evaluate(
    ({ x, y, deltaY }) => {
      const el = document.elementFromPoint(x, y)
      el?.dispatchEvent(
        new WheelEvent('wheel', { clientX: x, clientY: y, deltaY, deltaMode: 0, ctrlKey: true, bubbles: true, cancelable: true }),
      )
    },
    { x, y, deltaY },
  )
}

// Ctrl/Cmd+wheel zooms (React Flow's zoomActivationKeyCode default); a bare
// wheel PANS instead (Canvas.tsx sets panOnScroll). Loops small wheel steps
// (no fixed sleeps) until within tolerance of `target`, bounded so a
// misbehaving zoom can't hang the test.
//
// KNOWN GAP (WebKit only — see README): this reliably reaches `target` on
// Chromium and Firefox. On Playwright's WebKit, the dispatched wheel events
// visibly reach d3-zoom (devtools trace shows `preventDefault()` called
// every time) but the net scale after the whole loop stays at 1 — each
// tick's zoom appears to get reverted before the next read, even with a
// settle wait between dispatches. Tried: page.mouse.wheel (no effect at
// all on WebKit), a plain rAF settle, and a transform-stability poll — none
// changed the outcome, so this looks like a real fidelity gap in how
// Playwright's WebKit build delivers synthetic wheel gestures to a
// non-native (dispatchEvent-based) sender, not a bug in this helper's own
// logic. zoom.spec.ts's pan-based case (same "click after a view-transform
// change" concern, no wheel involved) passes on all three engines.
export async function zoomToApprox(page: Page, target: number, center: { x: number; y: number }, tolerance = 0.1): Promise<void> {
  try {
    for (let i = 0; i < 60; i++) {
      const z = await getZoom(page)
      if (Math.abs(z - target) <= tolerance) return
      await dispatchWheel(page, center.x, center.y, z < target ? -80 : 80)
      await settleFrame(page)
    }
  } finally {
    await settleFrame(page)
  }
}

// Plain left-drag over empty canvas pans the viewport (panOnDrag is on by
// default and Canvas.tsx doesn't restrict it; selectionKeyCode stays Shift,
// so an unmodified drag never box-selects).
// Two animation frames: lets React commit + the browser paint the result of
// a just-finished gesture (drag release, wheel zoom) before the NEXT step
// measures a bounding box off it — not a fixed sleep, just "wait for the
// frame to actually settle" (observed live: reading a handle's
// boundingBox() immediately after panCanvasBy's mouseup occasionally raced
// the viewport transform's own commit, landing a click a few px off and
// missing the dot — an infra timing gap, not app flakiness).
async function settleFrame(page: Page): Promise<void> {
  await page.evaluate(
    () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  )
}

export async function panCanvasBy(page: Page, dx: number, dy: number): Promise<void> {
  const box = await page.locator('.react-flow__pane').boundingBox()
  if (!box) throw new Error('panCanvasBy: pane not found')
  const start = { x: box.x + box.width / 2, y: box.y + Math.min(box.height - 40, box.height / 2 + 150) }
  await dragFromTo(page, start, { x: start.x + dx, y: start.y + dy })
  await settleFrame(page)
}

// ── Hover indicator (see README's "hover indicator selector" note) ──────

// The point-creation region hover indicator (FormNode.tsx's RegionOverlay /
// CenterOverlay) is a plain, class-less <div> whose only distinguishing
// trait is its inline `background: var(--color-hover)` style — there is no
// data-testid. Scoped to the given node so it can't match an unrelated
// element elsewhere on the page.
export function hoverIndicator(page: Page, nodeId: string) {
  return page.locator(`.react-flow__node[data-id="${nodeId}"] div[style*="var(--color-hover)"]`)
}
