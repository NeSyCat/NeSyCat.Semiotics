import { test, expect } from '@playwright/test'
import { gotoFreshEditor, addShapeAt, addPointAt, handleCenter, dragFromTo, clickPointDot, edgeCount, nodeCount, handleIds, nodeSpot, SQUARE_SIDES } from './helpers/canvas'

// Wire (line) creation by dragging from a point's dot. Existing-and-working
// behavior — expected to PASS on this baseline (dragging, unlike a plain
// click, does not go through the buggy click-resolver path).

test.describe('wires', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreshEditor(page)
  })

  test("dragging from a point's dot to another form's side creates an edge", async ({ page }) => {
    const f1 = await addShapeAt(page, 'square', { x: 300, y: 300 })
    const p1 = await addPointAt(page, f1, ...(SQUARE_SIDES.right))
    expect(p1.handleId).toBe('right:0')

    const f2 = await addShapeAt(page, 'square', { x: 700, y: 300 })

    expect(await edgeCount(page)).toBe(0)
    const from = await handleCenter(page, f1, 'right:0')
    const to = await nodeSpot(page, f2, ...(SQUARE_SIDES.left))
    await dragFromTo(page, from, to)

    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  })

  test('pressing a dot and releasing without moving creates no edge and no new point', async ({ page }) => {
    const f1 = await addShapeAt(page, 'square', { x: 400, y: 300 })
    const p1 = await addPointAt(page, f1, ...(SQUARE_SIDES.top))
    expect(p1.handleId).toBe('top:0')

    const before = await handleIds(page, f1)
    expect(await edgeCount(page)).toBe(0)

    await clickPointDot(page, f1, 'top:0') // plain click: press + release, zero movement

    expect(await edgeCount(page)).toBe(0)
    const after = await handleIds(page, f1)
    expect(after.length).toBe(before.length)
  })

  test('dragging from a dot to empty canvas creates a new carrier node + edge', async ({ page }) => {
    const f1 = await addShapeAt(page, 'square', { x: 300, y: 300 })
    const p1 = await addPointAt(page, f1, ...(SQUARE_SIDES.right))
    expect(p1.handleId).toBe('right:0')

    const before = await nodeCount(page)
    expect(await edgeCount(page)).toBe(0)

    const from = await handleCenter(page, f1, 'right:0')
    await dragFromTo(page, from, { x: from.x + 250, y: from.y + 40 })

    await expect
      .poll(async () => nodeCount(page), { message: 'waiting for a new carrier node to appear' })
      .toBe(before + 1)
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)
  })
})
