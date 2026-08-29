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
      await pageA.getByRole('button', { name: 'New diagram' }).click()
      await pageA.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 15_000 })
      const diagramId = diagramIdFromUrl(pageA.url())
      expect(diagramId).not.toBeNull()

      const pageB = await contextB.newPage()
      await gotoEditorDiagram(pageB, diagramId!)
      await expect(pageB.locator('.react-flow__node')).toHaveCount(0)

      await addShapeAt(pageA, 'square', { x: 300, y: 300 })

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
