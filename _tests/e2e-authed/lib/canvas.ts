import { type Page } from '@playwright/test'

// Re-exports the anonymous lane's canvas driver wholesale — same
// `.react-flow__pane` canvas, same toolbar, same selection oracle, whether
// the diagram is anonymous/localStorage-backed or a real authed/DB-backed
// one (app/editor/[id]/page.tsx renders the identical CanvasRoot either
// way). Per the ticket's write set fence, this lane must not edit
// _tests/e2e/helpers/canvas.ts itself — only import it and, where a helper
// needs generalizing for the authed case, wrap it here instead (see
// gotoEditorDiagram below, this lane's one addition).
export * from '../../e2e/helpers/canvas'

// gotoFreshEditor (_tests/e2e/helpers/canvas.ts) navigates to `/editor` and
// clears localStorage — built for the anonymous, localStorage-backed
// editor. The authed lane instead has a specific DB-backed diagram id to
// open (created via createDiagram/seeding, not localStorage), so this is a
// small, authed-specific sibling rather than a bypass of the ticket's
// "don't touch helpers/canvas.ts" fence.
export async function gotoEditorDiagram(page: Page, diagramId: string): Promise<void> {
  await page.goto(`/editor/${diagramId}`)
  await page.locator('.react-flow__pane').waitFor({ state: 'visible' })
}
