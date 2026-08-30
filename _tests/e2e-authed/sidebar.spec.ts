import { test, expect } from '@playwright/test'
import { PRIMARY_STORAGE_STATE } from './lib/paths'
import { diagramIdFromUrl } from './lib/ids'

// A sidebar row is a DiagramItem (components/DiagramItem.tsx) — the only
// `.pill.editor-pill` element that also carries `cursor-pointer`; the
// search box and the actions bar reuse the same `.pill.editor-pill` base
// class without it, so this compound selector is what actually scopes to
// list rows (see components/EditorSidebar.tsx / DiagramItem.tsx).
//
// This spec navigates between distinct /editor/[id] routes (gotoEditorLanding
// -> "New diagram" -> ...), which is exactly what leaves a PREVIOUS route's
// whole tree — sidebar rows included — sitting hidden in the DOM under
// React's <Activity mode="hidden"> once cacheComponents is on (see
// node_modules/next/dist/docs/01-app/02-guides/preserving-ui-state.md,
// "Testing": raw locators match hidden Activity content same as visible).
// `row()` below is the ONE place ROW becomes a Locator, always scoped with
// `.filter({ visible: true })` — the docs' own documented fallback for a
// plain `.locator()` — so no call site below needs its own ad-hoc filter,
// matching the mechanism `_tests/e2e/helpers/canvas.ts` uses for the anon
// lane's own locators (see that file's header comment).
const ROW = '.pill.editor-pill.cursor-pointer'

function row(page: import('@playwright/test').Page, hasText?: string | RegExp) {
  return page.locator(ROW, hasText === undefined ? undefined : { hasText }).filter({ visible: true })
}

async function gotoEditorLanding(page: import('@playwright/test').Page) {
  await page.goto('/editor')
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })
  // The URL above only proves the PAGE segment's own redirect happened —
  // the sidebar (EditorLayout's AuthedExtras) streams in behind its OWN,
  // separate Suspense boundary and can commit a beat later. Without this
  // wait, an immediate `row(page).count()` right after this function
  // returns can race that stream and read 0 even though the org already
  // has diagrams server-side (observed: a "rowsBefore" of 0 against an
  // actual 3, later assertions then comparing against the wrong baseline).
  // Every org always has >=1 diagram (auto-created if the list was empty —
  // see app/editor/page.tsx's EditorIndexContent), so waiting for the first
  // row to actually be visible is always safe, never a hang on empty state.
  await row(page).first().waitFor({ state: 'visible', timeout: 20_000 })
}

// Settle grace after a "New diagram" click, before interacting with the
// sidebar's toolbar again (Rename/Delete). Separate, PRE-EXISTING race, not
// one of this ticket's two Activity fixes (reproduces identically on the
// unmodified baseline) — worth flagging for its own follow-up: "New
// diagram"'s optimistic row (EditorSidebar's `optimisticNew`/`optimisticId`
// local state) appears instantly, but a beat later the sidebar segment
// re-renders off the server's now-revalidated list; clicking "Rename
// selected diagram" (which stores `editingId` in that SAME local state) in
// the narrow window between those two can have its edit-mode flag land on
// the render that's about to be superseded, so the input this test types
// into and commits never surfaces in the row that survives. Same idiom as
// this suite's existing WAL-poller-grace `waitForTimeout(750)`.
async function settleAfterNav(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForTimeout(500)
}

test.describe('sidebar', () => {
  test('create: lands on a new diagram and appears in the list', async ({ page }) => {
    await gotoEditorLanding(page)
    const initialId = diagramIdFromUrl(page.url())
    const rowsBefore = await row(page).count()

    await page.getByRole('button', { name: 'New diagram' }).click()
    await page.waitForURL((url) => diagramIdFromUrl(url.pathname) !== initialId, { timeout: 15_000 })

    await expect(row(page)).toHaveCount(rowsBefore + 1)
  })

  test('rename: instant optimistic title, persists after reload', async ({ page }) => {
    await gotoEditorLanding(page)
    await page.getByRole('button', { name: 'New diagram' }).click()
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 15_000 })
    await settleAfterNav(page)

    const newTitle = `Renamed ${Date.now()}`
    await page.getByRole('button', { name: 'Rename selected diagram' }).click()
    const input = row(page).locator('input')
    await input.fill(newTitle)
    await input.press('Enter')

    // Optimistic: DiagramItem's commit() sets local title state and fires
    // the server action in a transition with no revalidation wait — this
    // resolving well inside the default 5s expect timeout (a local dev
    // server, no network latency) is the observable signature of "instant."
    await expect(row(page, newTitle)).toBeVisible()

    // Reload re-fetches from the server — proves the rename actually
    // persisted, not just client-side optimism.
    await page.reload()
    await expect(row(page, newTitle)).toBeVisible()
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
      await settleAfterNav(pageA)

      const targetTitle = `ToDelete ${Date.now()}`
      await pageA.getByRole('button', { name: 'Rename selected diagram' }).click()
      const inputA = row(pageA).locator('input')
      await inputA.fill(targetTitle)
      await inputA.press('Enter')
      await expect(row(pageA, targetTitle)).toBeVisible()

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
      await expect(row(pageB, targetTitle)).toBeVisible()

      // Delete from A, where it IS the open diagram → A navigates away
      // (EditorSidebar.handleDelete's `onThis` branch).
      pageA.once('dialog', (d) => void d.accept())
      await pageA.getByRole('button', { name: 'Delete selected diagram' }).click()
      await pageA.waitForURL((url) => diagramIdFromUrl(url.pathname) !== targetId, { timeout: 15_000 })

      // B never navigated or reloaded — the row disappearing here is the
      // live realtime DELETE handler (lib/realtime/use-diagrams-channel.ts's
      // onDelete → EditorSidebar's removedIds), not a fresh server render.
      await expect(row(pageB, targetTitle)).toHaveCount(0, { timeout: 15_000 })

      // Reload confirms it's really gone server-side too.
      await pageB.reload()
      await expect(row(pageB, targetTitle)).toHaveCount(0)
    } finally {
      await contextA.close()
      await contextB.close()
    }
  })
})
