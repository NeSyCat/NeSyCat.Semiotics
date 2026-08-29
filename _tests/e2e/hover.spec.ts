import { test, expect } from '@playwright/test'
import { gotoFreshEditor, addShapeAt, addPointAt, handleCenter, getZoom, nodeSpot, hoverIndicator } from './helpers/canvas'

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

  test('an existing point activates EXACTLY within its visible disc — just outside it, the form (centre zone) hovers instead', async ({ page }) => {
    // THE general activation rule (Canvas.tsx's POINT_HOVER_RADIUS =
    // POINT_SIZE/2): a point is hovered/clickable/draggable only when the
    // cursor is inside its drawn disc (radius 13 local px) — a cursor just
    // outside it (here 16 local px below the anchor, a spot the old
    // invisible 18px radius would have claimed for the point) belongs to
    // whatever is underneath: for an interior point, the form's own centre
    // zone, i.e. whole-form hover/drag.
    //
    // Observable: point hover tints the glyph via SVG fill (no overlay DIV),
    // while centre-zone hover renders the CenterOverlay div hoverIndicator()
    // matches — so the indicator count flips 1 (just outside) -> 0 (on the
    // point) exactly at the disc edge.
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    await addPointAt(page, formId, 0.5, 0.25) // interior centre-up point
    const dot = await handleCenter(page, formId, 'center-up:0')
    const zoom = await getZoom(page)

    // clear any hover left over from creation
    await page.mouse.move(60, 500)
    await expect(hoverIndicator(page, formId)).toHaveCount(0)

    // 16 local px below the anchor: outside the 13px disc, inside the centre
    // zone -> whole-form hover (CenterOverlay), NOT point hover
    await page.mouse.move(dot.x, dot.y + 16 * zoom)
    await expect(hoverIndicator(page, formId)).toHaveCount(1)

    // on the dot itself: point hover -> the overlay div disappears
    await page.mouse.move(dot.x, dot.y)
    await expect(hoverIndicator(page, formId)).toHaveCount(0)
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
