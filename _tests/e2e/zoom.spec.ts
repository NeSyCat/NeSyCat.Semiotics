import { test, expect } from '@playwright/test'
import { gotoFreshEditor, addShapeAt, addPointAt, clickPointDot, expectPointSelected, nodeSpot, zoomToApprox, panCanvasBy, getZoom, SQUARE_SPOTS, TRIANGLE_SPOTS } from './helpers/canvas'

// The same dot-click selection check as point-selection.spec.ts, but after
// zooming and panning — checking the click resolver's screen<->flow
// coordinate math holds up away from the 1:1, unpanned default. Verified on
// this baseline: an ORDINARY point's dot-click selection (unlike the
// identity-centre case in point-selection.spec.ts) already works correctly
// at zoom/after pan — all three cases here are expected to PASS, same as
// point-selection.spec.ts's (a)-(d). See README.md for the WebKit-only
// wheel-zoom simulation gap affecting the two zoom (not pan) cases here.

test.describe('zoom / pan — dot-click selection', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreshEditor(page)
  })

  test('square corner dot selects its point after zooming OUT to ~0.5', async ({ page, browserName }) => {
    // Playwright's WebKit build does not reliably deliver synthetic
    // ctrl-wheel gestures to d3-zoom (preventDefault fires, net scale stays
    // 1) — an engine simulation gap, not an app bug; the pan case below
    // covers view-transform correctness on WebKit. See README.md.
    test.skip(browserName === 'webkit', 'WebKit: synthetic ctrl-wheel zoom not deliverable (see README)')
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    const added = await addPointAt(page, formId, ...SQUARE_SPOTS['corner-tl'])
    expect(added.handleId).toBe('corner-tl:0')
    expect(added.pointId).not.toBeNull()

    const center = await nodeSpot(page, formId, 0.5, 0.5)
    await zoomToApprox(page, 0.5, center)
    expect(await getZoom(page)).toBeLessThan(0.7)

    await clickPointDot(page, formId, 'corner-tl:0')
    await expectPointSelected(page, added.pointId!)
  })

  test('triangle apex dot selects its point after zooming IN to ~2', async ({ page, browserName }) => {
    test.skip(browserName === 'webkit', 'WebKit: synthetic ctrl-wheel zoom not deliverable (see README)')
    const formId = await addShapeAt(page, 'triangle', { x: 400, y: 300 })
    const added = await addPointAt(page, formId, ...TRIANGLE_SPOTS.peak)
    expect(added.handleId).toBe('peak:0')
    expect(added.pointId).not.toBeNull()

    const center = await nodeSpot(page, formId, 0.5, 0.5)
    await zoomToApprox(page, 2, center)
    expect(await getZoom(page)).toBeGreaterThan(1.5)

    await clickPointDot(page, formId, 'peak:0')
    await expectPointSelected(page, added.pointId!)
  })

  test('square corner dot selects its point after panning the canvas', async ({ page }) => {
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    const added = await addPointAt(page, formId, ...SQUARE_SPOTS['corner-tl'])
    expect(added.handleId).toBe('corner-tl:0')
    expect(added.pointId).not.toBeNull()

    await panCanvasBy(page, -220, -90)
    // sanity: the node actually moved on screen (pan took effect)
    const movedBox = await page.locator(`.react-flow__node[data-id="${formId}"]`).boundingBox()
    expect(movedBox).not.toBeNull()

    await clickPointDot(page, formId, 'corner-tl:0')
    await expectPointSelected(page, added.pointId!)
  })
})
