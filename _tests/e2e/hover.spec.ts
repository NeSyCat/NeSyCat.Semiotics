import { test, expect } from '@playwright/test'
import { gotoFreshEditor, addShapeAt, nodeSpot, hoverIndicator } from './helpers/canvas'

// Point-creation region hover indicator (FormNode.tsx's RegionOverlay), from
// both outside and inside the form. Existing-and-working behavior —
// expected to PASS on this baseline.
//
// SELECTOR NOTE (see README): the indicator is a plain, class-less <div>
// with no data-testid — the only thing that distinguishes it in the DOM is
// its inline `background: var(--color-hover)` style (a CSS custom
// property, kept literally in the `style` attribute). `hoverIndicator()`
// (helpers/canvas.ts) scopes an attribute-substring match to the node under
// test. A future data-testid on RegionOverlay/CenterOverlay would be a nice
// simplification here, but this works against the current DOM.

test.describe('hover indicator', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreshEditor(page)
  })

  test('a corner spot shows a hover indicator, approached from OUTSIDE the form', async ({ page }) => {
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    const indicator = hoverIndicator(page, formId)
    await expect(indicator).toHaveCount(0)

    const corner = await nodeSpot(page, formId, 0, 0)
    // start well outside the node's box (down-left, clear of the top-center
    // toolbar pill), then move onto the spot
    await page.mouse.move(corner.x - 150, corner.y + 150)
    await expect(indicator).toHaveCount(0)
    await page.mouse.move(corner.x, corner.y)

    await expect(indicator).toHaveCount(1)
    await expect(indicator).toBeVisible()
  })

  test('the SAME corner spot shows a hover indicator, approached from INSIDE the form', async ({ page }) => {
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    const indicator = hoverIndicator(page, formId)

    // clear any hover left by node creation itself
    await page.mouse.move(60, 500)
    await expect(indicator).toHaveCount(0)

    const inside = await nodeSpot(page, formId, 0.5, 0.5) // the form's own centre zone
    await page.mouse.move(inside.x, inside.y)
    // The centre zone renders its OWN hover overlay (CenterOverlay) through
    // the same `var(--color-hover)` styling — hoverIndicator() can't tell
    // the two apart by color alone, so this only confirms "some" indicator
    // is showing before the cursor continues on to the corner below.
    await expect(indicator).toHaveCount(1)

    const corner = await nodeSpot(page, formId, 0, 0)
    await page.mouse.move(corner.x, corner.y)

    await expect(indicator).toHaveCount(1)
    await expect(indicator).toBeVisible()
  })
})
