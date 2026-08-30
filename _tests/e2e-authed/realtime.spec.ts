import { test, expect } from '@playwright/test'
import { PRIMARY_STORAGE_STATE } from './lib/paths'
import { diagramIdFromUrl } from './lib/ids'
import { addShapeAt, gotoEditorDiagram } from './lib/canvas'

// Two browser CONTEXTS of the SAME (primary) user — the two-client
// authenticated Realtime coverage _tests/e2e/README.md's "Realtime" section
// flags as missing from the anonymous lane (which runs with no session, so
// every realtime hook there no-ops by construction). Requires
// prisma/sql/03-realtime.sql to have actually been applied (it is, as part
// of scripts/setup.ts's bootstrapDatabase() — see that file) — no event
// flows without it, even with a correctly-subscribing client.
//
// This spec navigates between distinct /editor/[id] routes (goto('/editor')
// -> "New diagram" -> ...), which is exactly what leaves a PREVIOUS route's
// whole tree — sidebar rows included — sitting hidden in the DOM under
// React's <Activity mode="hidden"> once cacheComponents is on (see
// node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md,
// "Testing": raw locators match hidden Activity content same as visible).
// `row()` below is the ONE place ROW becomes a Locator, always scoped with
// `.filter({ visible: true })` — same mechanism as sidebar.spec.ts's own
// `row()` and `_tests/e2e/helpers/canvas.ts`'s header comment.
const ROW = '.pill.editor-pill.cursor-pointer'

function row(page: import('@playwright/test').Page, hasText?: string | RegExp) {
  return page.locator(ROW, hasText === undefined ? undefined : { hasText }).filter({ visible: true })
}

// The URL reflecting /editor/[id] only proves the PAGE segment's own
// redirect happened — the sidebar (EditorLayout's AuthedExtras) streams in
// behind its OWN, separate Suspense boundary and can commit a beat later.
// Every `.click()`/`expect().toBeVisible()` below already auto-waits past
// that gap on its own, but this is still called right after every landing
// so a future one-shot read (a `.count()`, an immediate `.textContent()`)
// added here doesn't inherit the same race sidebar.spec.ts's `create` test
// hit (see that file's own `gotoEditorLanding` comment). Every org always
// has >=1 diagram (auto-created if the list was empty), so this never hangs
// on an empty state.
async function waitForSidebarReady(page: import('@playwright/test').Page): Promise<void> {
  await row(page).first().waitFor({ state: 'visible', timeout: 20_000 })
}

test.describe('realtime (same user, two browser contexts)', () => {
  test('sidebar: a rename in A appears in B without B reloading', async ({ browser }) => {
    const contextA = await browser.newContext({ storageState: PRIMARY_STORAGE_STATE })
    const contextB = await browser.newContext({ storageState: PRIMARY_STORAGE_STATE })
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      // Relay B's browser console into the test output — realtime failures
      // are otherwise invisible (a channel that never delivers logs nothing
      // in the DOM); the hooks log subscribe status via console.debug/error.
      pageB.on('console', (m) => console.log('[pageB console]', m.type(), m.text()))

      await pageA.goto('/editor')
      await pageA.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })
      await waitForSidebarReady(pageA)
      await pageA.getByRole('button', { name: 'New diagram' }).click()
      await pageA.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 15_000 })
      // Settle grace — see sidebar.spec.ts's `settleAfterNav` comment: a
      // PRE-EXISTING, separate race (reproduces on the unmodified baseline
      // too) between "New diagram"'s optimistic sidebar state and its
      // follow-up server-revalidated re-render, which the very next step
      // (Rename) can otherwise lose its edit to.
      await pageA.waitForTimeout(500)

      // B loads the org's sidebar once — same list, any diagram open.
      await pageB.goto('/editor')
      await pageB.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })
      await waitForSidebarReady(pageB)

      const title = `Realtime ${Date.now()}`
      await pageA.getByRole('button', { name: 'Rename selected diagram' }).click()
      const input = row(pageA).locator('input')
      await input.fill(title)
      await input.press('Enter')

      // No reload/navigation on B between here and the assertion — this is
      // lib/realtime/use-diagrams-channel.ts's onUpdate path, or onInsert +
      // onUpdate if B's initial server-fetched list predates A's create.
      await expect(row(pageB, title)).toBeVisible({ timeout: 20_000 })
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })

  test('canvas: a shape added in A appears in B on the same open diagram', async ({ browser }) => {
    const contextA = await browser.newContext({ storageState: PRIMARY_STORAGE_STATE })
    const contextB = await browser.newContext({ storageState: PRIMARY_STORAGE_STATE })
    try {
      const pageA = await contextA.newPage()
      await pageA.goto('/editor')
      await pageA.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })
      await waitForSidebarReady(pageA)
      // A is ALREADY on /editor/<uuid> here, so a plain pattern waitForURL
      // after the click resolves instantly against the OLD url and captures
      // the WRONG diagram id (B then subscribes to a diagram A never edits —
      // this exact race shipped as the spec's original flakiness). Wait for
      // a DIFFERENT uuid instead.
      const beforeCreateId = diagramIdFromUrl(pageA.url())
      await pageA.getByRole('button', { name: 'New diagram' }).click()
      await pageA.waitForURL((url) => {
        const id = diagramIdFromUrl(url.pathname)
        return id !== null && id !== beforeCreateId
      }, { timeout: 15_000 })
      const diagramId = diagramIdFromUrl(pageA.url())
      expect(diagramId).not.toBeNull()

      const pageB = await contextB.newPage()
      // Same console relay as the sidebar spec above — realtime failures are
      // invisible in the DOM; the hooks + persist layer log what they did.
      pageB.on('console', (m) => console.log('[pageB console]', m.type(), m.text()))
      // postgres_changes has NO replay: an event fired before B's channel
      // finishes registering is gone forever. Arm the wait BEFORE navigating,
      // then hold A's edit until B's content channel reports subscribed
      // (the hook's own console.debug is the observable signal).
      const bSubscribed = pageB.waitForEvent('console', {
        predicate: (m) => m.text().includes('useDiagramContentChannel: subscribed'),
        timeout: 20_000,
      })
      await gotoEditorDiagram(pageB, diagramId!)
      // .filter({ visible: true }) — same mechanism as helpers/canvas.ts's
      // nodeCount/nodeCount-shaped helpers (see that file's header comment):
      // this lane navigates between distinct /editor/[id] routes, so a raw
      // `.react-flow__node` count could otherwise also match a previous
      // route's hidden Activity-preserved tree.
      await expect(pageB.locator('.react-flow__node').filter({ visible: true })).toHaveCount(0)
      await bSubscribed
      // Client-side SUBSCRIBED can precede the server's WAL poller picking up
      // the new subscription row by a beat — a short grace keeps this exact
      // once-per-test race out of the assertion below.
      await pageB.waitForTimeout(750)

      // Assert the ADD landed in A first (fail at the cause, not downstream):
      // in authed mode the sidebar overlays part of the canvas, so the anon
      // helper's default position can silently click a UI panel instead.
      await addShapeAt(pageA, 'square', { x: 640, y: 420 })
      await expect(pageA.locator('.react-flow__node').filter({ visible: true })).toHaveCount(1)

      // B never reloads — this is lib/realtime/use-diagram-content-channel.ts
      // hydrating the canvas store in place from a postgres_changes UPDATE
      // on this diagram's row, wired inside useAutosave
      // (components/editor/persist/save.ts). Generous timeout: this depends
      // on A's own autosave write actually landing in Postgres first, not
      // just A's local state changing.
      await expect(pageB.locator('.react-flow__node').filter({ visible: true })).toHaveCount(1, { timeout: 20_000 })
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
