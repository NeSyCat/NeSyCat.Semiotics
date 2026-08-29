import { test, expect } from '@playwright/test'
import {
  gotoFreshEditor,
  addShapeAt,
  addPointAt,
  handleIds,
  SQUARE_SPOTS,
  SQUARE_SIDES,
  TRIANGLE_SPOTS,
  TRIANGLE_SIDES,
  RHOMBUS_SPOTS,
  CIRCLE_SPOTS,
  CIRCLE_SIDES,
} from './helpers/canvas'

// Point creation via double-click, parametrized over every point kind the
// ticket calls out. Existing-and-working behavior — expected to PASS.

test.describe('point creation', () => {
  test.beforeEach(async ({ page }) => {
    await gotoFreshEditor(page)
  })

  test('square: every corner + both centre spots + the identity centre + all four sides', async ({ page }) => {
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    for (const [edgeKey, [fx, fy]] of Object.entries(SQUARE_SPOTS)) {
      await test.step(`spot ${edgeKey}`, async () => {
        const added = await addPointAt(page, formId, fx, fy)
        expect(added.handleId, `expected a new handle at ${edgeKey}`).toBe(`${edgeKey}:0`)
      })
    }
    for (const [edgeKey, [fx, fy]] of Object.entries(SQUARE_SIDES)) {
      await test.step(`side ${edgeKey}`, async () => {
        const added = await addPointAt(page, formId, fx, fy)
        expect(added.handleId, `expected a new handle at ${edgeKey}`).toBe(`${edgeKey}:0`)
      })
    }
  })

  test('square: a capacity-1 spot does not create a second point on repeat double-click', async ({ page }) => {
    const formId = await addShapeAt(page, 'square', { x: 400, y: 300 })
    const [fx, fy] = SQUARE_SPOTS['corner-tl']
    const first = await addPointAt(page, formId, fx, fy)
    expect(first.handleId).toBe('corner-tl:0')
    const before = await handleIds(page, formId)
    const second = await addPointAt(page, formId, fx, fy)
    expect(second.handleId, 'repeat double-click on a full capacity-1 spot must not add a new handle').toBeNull()
    const after = await handleIds(page, formId)
    expect(after.length).toBe(before.length)
  })

  test('triangle: apex (peak) + both base corners + the interior center-up spot + slant side a', async ({ page }) => {
    const formId = await addShapeAt(page, 'triangle', { x: 400, y: 300 })
    const cases: Array<[string, [number, number]]> = [
      ['peak', TRIANGLE_SPOTS.peak],
      ['corner-base-top', TRIANGLE_SPOTS['corner-base-top']],
      ['corner-base-bottom', TRIANGLE_SPOTS['corner-base-bottom']],
      ['center-up', TRIANGLE_SPOTS['center-up']],
      ['a', TRIANGLE_SIDES.a],
    ]
    for (const [edgeKey, [fx, fy]] of cases) {
      await test.step(`spot/side ${edgeKey}`, async () => {
        const added = await addPointAt(page, formId, fx, fy)
        expect(added.handleId, `expected a new handle at ${edgeKey}`).toBe(`${edgeKey}:0`)
      })
    }
  })

  test('rhombus: all four corners', async ({ page }) => {
    const formId = await addShapeAt(page, 'rhombus', { x: 400, y: 300 })
    for (const key of ['corner-top', 'corner-right', 'corner-bottom', 'corner-left']) {
      const [fx, fy] = RHOMBUS_SPOTS[key]
      await test.step(`corner ${key}`, async () => {
        const added = await addPointAt(page, formId, fx, fy)
        expect(added.handleId, `expected a new handle at ${key}`).toBe(`${key}:0`)
      })
    }
  })

  test('circle: centre-up, centre-down, and an arc side', async ({ page }) => {
    const formId = await addShapeAt(page, 'circle', { x: 400, y: 300 })
    const cases: Array<[string, [number, number]]> = [
      ['center-up', CIRCLE_SPOTS['center-up']],
      ['center-down', CIRCLE_SPOTS['center-down']],
      ['right', CIRCLE_SIDES.right],
    ]
    for (const [edgeKey, [fx, fy]] of cases) {
      await test.step(`spot/side ${edgeKey}`, async () => {
        const added = await addPointAt(page, formId, fx, fy)
        expect(added.handleId, `expected a new handle at ${edgeKey}`).toBe(`${edgeKey}:0`)
      })
    }
  })
})
