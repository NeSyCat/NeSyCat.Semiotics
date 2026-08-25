import { test, expect } from '@playwright/test'
import { gotoFreshEditor, addShapeAt, clickEmptyCanvas, expectFormSelected, expectNothingSelected } from './helpers/canvas'

// Baseline sanity: the editor route loads unauthenticated, the canvas
// renders, and the most basic create/select/deselect loop works. These
// exercise EXISTING, working behavior — expected to PASS on this baseline.

test.describe('smoke', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreshEditor(page)
  })

  test('editor route loads and the React Flow pane renders', async ({ page }) => {
    await expect(page.locator('.react-flow__pane')).toBeVisible()
    await expect(page.locator('.react-flow__node')).toHaveCount(0)
  })

  test('double-clicking empty canvas adds a square form with a data-id', async ({ page }) => {
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    expect(formId).toMatch(/^F/)
    await expect(page.locator(`.react-flow__node[data-id="${formId}"]`)).toBeVisible()
    await expect(page.locator('.react-flow__node')).toHaveCount(1)
  })

  test('clicking a form selects it (form oracle + .selected); clicking empty pane deselects', async ({ page }) => {
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    await page.locator(`.react-flow__node[data-id="${formId}"]`).click()
    await expectFormSelected(page, formId)
    await clickEmptyCanvas(page)
    await expectNothingSelected(page)
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
  })
})
