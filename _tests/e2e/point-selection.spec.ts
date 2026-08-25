import { test, expect } from '@playwright/test'
import {
  gotoFreshEditor,
  addShapeAt,
  addPointAt,
  clickPointDot,
  clickPointLabel,
  expectPointSelected,
  expectFormSelected,
  nodeSpot,
  renameSelected,
  ensureCategory,
  type Shape,
} from './helpers/canvas'

// THE regression suite for the known point-selection bug — the fix is WIP
// in a parallel task (see baseline commit 952eb6f: "WIP: geometric
// click-resolver (existingPointAtClient) shared by click paths").
//
// VERIFIED ON THIS BASELINE (run 3x per case, cross-checked on Chromium/
// Firefox/WebKit — see README.md's "Known-red-on-baseline" section for the
// full writeup): every ordinary point's dot/label click, and Cmd/Ctrl-click
// accumulation, already work correctly on this baseline
// (existingPointAtClient's WIP fix appears to have landed for the general
// case). Cases (a)-(d) are the regression suite FOR that fix's own future
// changes — they are expected to stay GREEN. A red (a)-(d) case is real
// news, not an assumption to wave away — investigate it same as any other
// failure, checking whether it's a genuine app regression or an infra
// problem (see README's "reading a failure" note for how to tell an
// assertion mismatch apart from a broken selector/timing).
//
// Case (e), the identity-CENTRE point's dot, is BY DESIGN not the same as
// (a)-(d): clicking it selects the identity POINT, not the form — the
// identity point's name IS the form's own name, so the toolbar's name field
// shows placeholder = the form's id (same as a form-selected oracle read)
// but VALUE = the form's name, while the form's own React Flow node does
// NOT carry `.selected` (selection stayed on the point). An earlier version
// of this case asserted the form itself became selected — that expectation
// was wrong; this is the corrected version.

interface Kind {
  name: string
  shape: Shape
  fx: number
  fy: number
  expectedHandle: string
  fx2: number
  fy2: number
  expectedHandle2: string
}

const KINDS: Kind[] = [
  { name: 'square corner', shape: 'square', fx: 0, fy: 0, expectedHandle: 'corner-tl:0', fx2: 1, fy2: 1, expectedHandle2: 'corner-br:0' },
  { name: 'square side', shape: 'square', fx: 0.5, fy: 0, expectedHandle: 'top:0', fx2: 0.5, fy2: 1, expectedHandle2: 'bottom:0' },
  { name: 'triangle apex', shape: 'triangle', fx: 1.0, fy: 0.5, expectedHandle: 'peak:0', fx2: 0.25, fy2: 0.067, expectedHandle2: 'corner-base-top:0' },
  { name: 'triangle center-up', shape: 'triangle', fx: 0.75, fy: 0.5, expectedHandle: 'center-up:0', fx2: 1.0, fy2: 0.5, expectedHandle2: 'peak:0' },
  { name: 'rhombus corner', shape: 'rhombus', fx: 0.5, fy: 0, expectedHandle: 'corner-top:0', fx2: 0.5, fy2: 1, expectedHandle2: 'corner-bottom:0' },
  { name: 'circle centre-up', shape: 'circle', fx: 0.5, fy: 0.25, expectedHandle: 'center-up:0', fx2: 0.5, fy2: 0.75, expectedHandle2: 'center-down:0' },
]

for (const kind of KINDS) {
  test.describe(`point selection — ${kind.name}`, () => {
    test.beforeEach(async ({ page }) => {
      await gotoFreshEditor(page)
    })

    test('(a) clicking the DOT selects the point, not the form', async ({ page }) => {
      const formId = await addShapeAt(page, kind.shape, { x: 400, y: 300 })
      const added = await addPointAt(page, formId, kind.fx, kind.fy)
      expect(added.handleId).toBe(kind.expectedHandle)
      expect(added.pointId, 'point should carry a [data-point-id] label').not.toBeNull()

      await clickPointDot(page, formId, kind.expectedHandle)
      await expectPointSelected(page, added.pointId!)
    })

    test('(b) clicking the LABEL selects the point, not the form', async ({ page }) => {
      const formId = await addShapeAt(page, kind.shape, { x: 400, y: 300 })
      const added = await addPointAt(page, formId, kind.fx, kind.fy)
      expect(added.pointId).not.toBeNull()

      await clickPointLabel(page, added.pointId!)
      await expectPointSelected(page, added.pointId!)
    })

    test("(c) ctrl-click a second point's dot accumulates the selection", async ({ page }) => {
      const formId = await addShapeAt(page, kind.shape, { x: 400, y: 300 })
      const first = await addPointAt(page, formId, kind.fx, kind.fy)
      const second = await addPointAt(page, formId, kind.fx2, kind.fy2)
      expect(first.pointId).not.toBeNull()
      expect(second.pointId).not.toBeNull()

      await clickPointDot(page, formId, first.handleId ?? kind.expectedHandle)
      await clickPointDot(page, formId, kind.expectedHandle2, { ctrl: true })

      // The oracle's own multi-select surface (Canvas.tsx's nameInfo):
      // 2+ points selected -> placeholder becomes "2 points". Minimum bar
      // regardless: the click must not have selected the FORM, and must not
      // have collapsed the selection down to nothing.
      await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
      await ensureCategory(page, 'name')
      const input = page.locator('.toolbar-second-pill input[type="text"]')
      await expect(input).not.toHaveAttribute('placeholder', 'Select a form, point, or line')
      await expect(input).toHaveAttribute('placeholder', '2 points')
    })

    test("(d) clicking the form's centre zone afterward re-selects the form", async ({ page }) => {
      const formId = await addShapeAt(page, kind.shape, { x: 400, y: 300 })
      const added = await addPointAt(page, formId, kind.fx, kind.fy)
      await clickPointDot(page, formId, added.handleId!)

      const center = await nodeSpot(page, formId, 0.5, 0.5)
      await page.mouse.click(center.x, center.y)
      await expectFormSelected(page, formId)
    })
  })
}

test.describe('point selection — identity centre', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreshEditor(page)
  })

  test("(e) the identity centre dot selects the identity POINT — oracle shows the form's id as placeholder, the form's name as value, and the form itself stays unselected", async ({ page }) => {
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    await page.locator(`.react-flow__node[data-id="${formId}"]`).click()
    await renameSelected(page, 'Widget')

    const added = await addPointAt(page, formId, 0.5, 0.5)
    expect(added.handleId).toBe('center:0')

    await clickPointDot(page, formId, 'center:0')
    const input = page.locator('.toolbar-second-pill input[type="text"]')
    await ensureCategory(page, 'name')
    await expect(input).toHaveAttribute('placeholder', formId)
    await expect(input).toHaveValue('Widget')
    await expect(page.locator('.react-flow__node.selected')).toHaveCount(0)
  })
})
