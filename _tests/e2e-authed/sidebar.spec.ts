import { test, expect } from '@playwright/test'
import { PRIMARY_STORAGE_STATE } from './lib/paths'
import { diagramIdFromUrl } from './lib/ids'

// A sidebar row is a DiagramItem (components/DiagramItem.tsx) — the only
// `.pill.editor-pill` element that also carries `cursor-pointer`; the
// search box and the actions bar reuse the same `.pill.editor-pill` base
// class without it, so this compound selector is what actually scopes to
// list rows (see components/EditorSidebar.tsx / DiagramItem.tsx).
const ROW = '.pill.editor-pill.cursor-pointer'

async function gotoEditorLanding(page: import('@playwright/test').Page) {
  await page.goto('/editor')
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })
}

test.describe('sidebar', () => {
  test('create: lands on a new diagram and appears in the list', async ({ page }) => {
    await gotoEditorLanding(page)
    const initialId = diagramIdFromUrl(page.url())
    const rowsBefore = await page.locator(ROW).count()

    await page.getByRole('button', { name: 'New diagram' }).click()
    await page.waitForURL((url) => diagramIdFromUrl(url.pathname) !== initialId, { timeout: 15_000 })

    await expect(page.locator(ROW)).toHaveCount(rowsBefore + 1)
  })

  test('rename: instant optimistic title, persists after reload', async ({ page }) => {
    await gotoEditorLanding(page)
    await page.getByRole('button', { name: 'New diagram' }).click()
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 15_000 })

    const newTitle = `Renamed ${Date.now()}`
    await page.getByRole('button', { name: 'Rename selected diagram' }).click()
    const input = page.locator(`${ROW} input`)
    await input.fill(newTitle)
    await input.press('Enter')

    // Optimistic: DiagramItem's commit() sets local title state and fires
    // the server action in a transition with no revalidation wait — this
    // resolving well inside the default 5s expect timeout (a local dev
    // server, no network latency) is the observable signature of "instant."
    await expect(page.locator(ROW, { hasText: newTitle })).toBeVisible()

    // Reload re-fetches from the server — proves the rename actually
    // persisted, not just client-side optimism.
    await page.reload()
    await expect(page.locator(ROW, { hasText: newTitle })).toBeVisible()
  })

  test('delete: the open tab navigates away; a second, non-open tab sees the row vanish via realtime, then confirmed gone after reload', async ({ browser }) => {
    const contextA = await browser.newContext({ storageState: PRIMARY_STORAGE_STATE })
    const contextB = await browser.newContext({ storageState: PRIMARY_STORAGE_STATE })
    try {
      const pageA = await contextA.newPage()
      const pageB = await contextB.newPage()
      // Console relay + subscription wait, same rationale as realtime.spec.ts:
      // the row-vanish assertion below rides the org channel's DELETE event.
      pageB.on('console', (m) => console.log('[pageB console]', m.type(), m.text()))

      await gotoEditorLanding(pageA)
      // Remember where A landed BEFORE creating the target — B will open
      // this one, guaranteed distinct from the diagram being deleted.
      const originalId = diagramIdFromUrl(pageA.url())
      expect(originalId).not.toBeNull()
      await pageA.getByRole('button', { name: 'New diagram' }).click()
      await pageA.waitForURL((url) => {
        const id = diagramIdFromUrl(url.pathname)
        return id !== null && id !== originalId
      }, { timeout: 15_000 })
      const targetId = diagramIdFromUrl(pageA.url())
      expect(targetId).not.toBeNull()

      const targetTitle = `ToDelete ${Date.now()}`
      await pageA.getByRole('button', { name: 'Rename selected diagram' }).click()
      const inputA = pageA.locator(`${ROW} input`)
      await inputA.fill(targetTitle)
      await inputA.press('Enter')
      await expect(pageA.locator(ROW, { hasText: targetTitle })).toBeVisible()

      // B must be on a diagram OTHER than the one about to be deleted —
      // but /editor redirects to the MOST-RECENTLY-UPDATED diagram, which is
      // exactly the just-created target (this spec's original landing-page
      // assumption broke itself). Navigate B explicitly to the diagram A
      // originally landed on instead.
      const bSubscribed = pageB.waitForEvent('console', {
        predicate: (m) => m.text().includes('useDiagramsChannel: subscribed'),
        timeout: 20_000,
      })
      await pageB.goto(`/editor/${originalId}`)
      await pageB.waitForURL(new RegExp(`/editor/${originalId}`), { timeout: 20_000 })
      expect(diagramIdFromUrl(pageB.url())).not.toBe(targetId)
      await bSubscribed
      await pageB.waitForTimeout(750) // WAL-poller grace, see realtime.spec.ts
      await expect(pageB.locator(ROW, { hasText: targetTitle })).toBeVisible()

      // Delete from A, where it IS the open diagram → A navigates away
      // (EditorSidebar.handleDelete's `onThis` branch).
      pageA.once('dialog', (d) => void d.accept())
      await pageA.getByRole('button', { name: 'Delete selected diagram' }).click()
      await pageA.waitForURL((url) => diagramIdFromUrl(url.pathname) !== targetId, { timeout: 15_000 })

      // B never navigated or reloaded — the row disappearing here is the
      // live realtime DELETE handler (lib/realtime/use-diagrams-channel.ts's
      // onDelete → EditorSidebar's removedIds), not a fresh server render.
      await expect(pageB.locator(ROW, { hasText: targetTitle })).toHaveCount(0, { timeout: 15_000 })

      // Reload confirms it's really gone server-side too.
      await pageB.reload()
      await expect(pageB.locator(ROW, { hasText: targetTitle })).toHaveCount(0)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
