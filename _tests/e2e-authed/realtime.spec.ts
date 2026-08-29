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
const ROW = '.pill.editor-pill.cursor-pointer'

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
      await pageA.getByRole('button', { name: 'New diagram' }).click()
      await pageA.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 15_000 })

      // B loads the org's sidebar once — same list, any diagram open.
      await pageB.goto('/editor')
      await pageB.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })

      const title = `Realtime ${Date.now()}`
      await pageA.getByRole('button', { name: 'Rename selected diagram' }).click()
      const input = pageA.locator(`${ROW} input`)
      await input.fill(title)
      await input.press('Enter')

      // No reload/navigation on B between here and the assertion — this is
      // lib/realtime/use-diagrams-channel.ts's onUpdate path, or onInsert +
      // onUpdate if B's initial server-fetched list predates A's create.
      await expect(pageB.locator(ROW, { hasText: title })).toBeVisible({ timeout: 20_000 })
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
      await expect(pageB.locator('.react-flow__node')).toHaveCount(0)
      await bSubscribed
      // Client-side SUBSCRIBED can precede the server's WAL poller picking up
      // the new subscription row by a beat — a short grace keeps this exact
      // once-per-test race out of the assertion below.
      await pageB.waitForTimeout(750)

      // Assert the ADD landed in A first (fail at the cause, not downstream):
      // in authed mode the sidebar overlays part of the canvas, so the anon
      // helper's default position can silently click a UI panel instead.
      await addShapeAt(pageA, 'square', { x: 640, y: 420 })
      await expect(pageA.locator('.react-flow__node')).toHaveCount(1)

      // B never reloads — this is lib/realtime/use-diagram-content-channel.ts
      // hydrating the canvas store in place from a postgres_changes UPDATE
      // on this diagram's row, wired inside useAutosave
      // (components/editor/persist/save.ts). Generous timeout: this depends
      // on A's own autosave write actually landing in Postgres first, not
      // just A's local state changing.
      await expect(pageB.locator('.react-flow__node')).toHaveCount(1, { timeout: 20_000 })
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
