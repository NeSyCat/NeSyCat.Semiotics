import { writeFileSync } from 'node:fs'
import { test, expect, type Page } from '@playwright/test'
import { gotoFreshEditor, addShapeAt, addPointAt, handleCenter, dragFromTo, handleIds, nodeCount, SQUARE_SIDES } from './helpers/canvas'

// Bezier mode ALWAYS draws a cubic, whatever a wire is drawn to — a port, a
// free end (the carrier node a drag-to-empty-canvas spins up), or another
// free end. Two shapes used to come out as a bare straight segment, both in
// the canvas and in the TikZ export a paper figure is built from:
//   (1) a box port wired to a free end sitting a few px off level — the
//       angular straightness guard intercepted the chord before the style
//       was even consulted, drawing a slanted diagonal instead of a level
//       stub that eases onto the free end;
//   (2) a free end wired to another free end — with NEITHER end directed the
//       cubic fell back to the chord, which is the straight line.
// The angular guard is now a smoothstep-only concern; these specs pin the
// user-visible outcome of that in a real browser.

const EVIDENCE_DIR = process.env.E2E_EVIDENCE_DIR

async function snap(page: Page, name: string): Promise<void> {
  if (!EVIDENCE_DIR) return
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}.png` })
  // A close-up of the wire region at the higher device scale below, where a
  // few-px curve is visible to a reviewer.
  await page.screenshot({ path: `${EVIDENCE_DIR}/${name}-closeup.png`, clip: { x: 120, y: 160, width: 720, height: 340 } })
}

// The rendered wires — React Flow's own edge path elements, one per line.
// Waits for `count` of them: a style switch briefly re-mounts the edges, so a
// bare evaluateAll right after it can observe an empty list.
async function edgePathDs(page: Page, count: number): Promise<string[]> {
  const paths = page.locator('.react-flow__edge path.react-flow__edge-path')
  let ds: string[] = []
  await expect
    .poll(async () => {
      ds = await paths.evaluateAll((els) => els.map((e) => e.getAttribute('d') ?? ''))
      return ds.filter(Boolean).length
    }, { message: `waiting for ${count} rendered wire path(s)` })
    .toBe(count)
  return ds
}

// Parses wirepath.ts's own bezier `d` format: `M sx sy C c1x c1y, c2x c2y, tx ty`.
function parseCubic(d: string): { s: [number, number]; c1: [number, number]; c2: [number, number]; t: [number, number] } | null {
  const m = d.match(/^M ([-\d.]+) ([-\d.]+) C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)$/)
  if (!m) return null
  const n = m.slice(1).map(Number)
  return { s: [n[0], n[1]], c1: [n[2], n[3]], c2: [n[4], n[5]], t: [n[6], n[7]] }
}

async function setWireStyle(page: Page, label: 'Straight' | 'Bezier' | 'Step'): Promise<void> {
  await page.locator('button[aria-label="Wire style"]').click()
  await page.locator('[role="menu"][aria-label="Wire style"] button', { hasText: label }).click()
  await expect(page.locator('button[aria-label="Wire style"]')).toHaveAttribute('title', `Wire style: ${label}`)
}

async function disableGridSnap(page: Page): Promise<void> {
  const btn = page.locator('button[title="Hide grid & disable snapping"]')
  if ((await btn.count()) > 0) await btn.click()
  await expect(page.locator('button[title="Show grid & snap to grid"]')).toBeVisible()
}

// Drags from a point's dot to empty canvas, returning the id of the carrier
// node the drop spun up (the free end).
async function dragToFreeEnd(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<string> {
  const before = new Set(await page.locator('.react-flow__node').filter({ visible: true }).evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? '')))
  await dragFromTo(page, from, to)
  await expect.poll(async () => nodeCount(page), { message: 'waiting for the carrier node' }).toBe(before.size + 1)
  const after = await page.locator('.react-flow__node').filter({ visible: true }).evaluateAll((els) => els.map((e) => e.getAttribute('data-id') ?? ''))
  const created = after.find((id) => !before.has(id))
  if (!created) throw new Error('dragToFreeEnd: no carrier node appeared')
  return created
}

// Reads the LaTeX tab of the Export panel as plain text (and, when
// E2E_EVIDENCE_DIR is set, keeps a copy next to the screenshots).
async function exportTikz(page: Page, evidenceName?: string): Promise<string> {
  await page.locator('button[aria-label="Export"]').click()
  await page.locator('.layout .pill button', { hasText: 'LaTeX' }).click()
  const body = page.locator('.export-shiki')
  await expect(body).not.toContainText('Generating…')
  await expect(body).toContainText('\\draw[')
  const text = await body.evaluate((el) => el.textContent ?? '')
  await page.locator('button[aria-label="Close"]').click()
  await expect(page.locator('.layout .export-shiki')).toHaveCount(0)
  if (EVIDENCE_DIR && evidenceName) writeFileSync(`${EVIDENCE_DIR}/${evidenceName}.tex`, text)
  return text
}

function tikzWireLines(tikz: string): string[] {
  return tikz.split('\n').filter((l) => l.trim().startsWith('\\draw[') && !l.includes('cycle') && !l.includes('draw='))
}

test.describe('bezier: a wire always curves, whatever it is drawn to', () => {
  // Crisper evidence screenshots only — CSS layout (and every coordinate the
  // assertions read) is identical at any device scale.
  test.use({ deviceScaleFactor: 2 })

  test.beforeEach(async ({ page }) => {
    await gotoFreshEditor(page)
    await disableGridSnap(page)
  })

  test('box port -> free end a few px off level: the canvas draws a cubic with a level departure, and the TikZ export emits `.. controls`', async ({ page }) => {
    const f1 = await addShapeAt(page, 'square', { x: 300, y: 300 })
    const p1 = await addPointAt(page, f1, ...(SQUARE_SIDES.right))
    expect(p1.handleId).toBe('right:0')

    // 6px down over a 250px run ≈ 1.4°: well inside the 10° angular guard.
    const from = await handleCenter(page, f1, 'right:0')
    await dragToFreeEnd(page, from, { x: from.x + 250, y: from.y + 6 })
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)

    await setWireStyle(page, 'Bezier')
    await snap(page, '01-box-to-free-end-bezier-canvas')

    const [d] = await edgePathDs(page, 1)
    const cubic = parseCubic(d)
    expect(cubic, `expected a cubic, got: ${d}`).not.toBeNull()
    expect(d).not.toContain(' L ')
    if (cubic) {
      const dx = cubic.t[0] - cubic.s[0]
      const dy = cubic.t[1] - cubic.s[1]
      expect(Math.abs(dy), 'fixture sanity: the free end is off level').toBeGreaterThan(1)
      expect(Math.abs(dy), 'fixture sanity: the chord is inside the 10° guard').toBeLessThanOrEqual(Math.tan((10 * Math.PI) / 180) * Math.abs(dx))
      // Leaves the box's right edge horizontally, arrives at the free end horizontally.
      expect(Math.abs(cubic.c1[1] - cubic.s[1])).toBeLessThan(0.01)
      expect(cubic.c1[0]).toBeGreaterThan(cubic.s[0])
      expect(Math.abs(cubic.c2[1] - cubic.t[1])).toBeLessThan(0.01)
      expect(cubic.c2[0]).toBeLessThan(cubic.t[0])
    }

    const wires = tikzWireLines(await exportTikz(page, '01-box-to-free-end-bezier-export'))
    expect(wires).toHaveLength(1)
    expect(wires[0]).toContain('.. controls')
    expect(wires[0]).not.toMatch(/\) -- \(/)
  })

  test('free end -> free end: the canvas draws a cubic whose tangents follow the dominant axis, and the TikZ export emits `.. controls`', async ({ page }) => {
    const f1 = await addShapeAt(page, 'square', { x: 250, y: 300 })
    await addPointAt(page, f1, ...(SQUARE_SIDES.right))
    const from = await handleCenter(page, f1, 'right:0')
    const hub = await dragToFreeEnd(page, from, { x: from.x + 180, y: from.y })

    // Fork from the free-end hub to a second loose end: neither end has an edge.
    // A connection drag that ends over the pane counts as a pane click (the
    // browser fires `click` on the common ancestor of mousedown/mouseup), and
    // two such drags inside onPaneClick's 350ms window would double-click a
    // shape into existence at the drop — a real user's two drags are never
    // that close, so space them out like one.
    await page.waitForTimeout(400)
    const [hubHandle] = await handleIds(page, hub)
    expect(hubHandle).toBeTruthy()
    const hubCenter = await handleCenter(page, hub, hubHandle)
    await dragToFreeEnd(page, hubCenter, { x: hubCenter.x + 220, y: hubCenter.y + 110 })
    await expect(page.locator('.react-flow__edge')).toHaveCount(2)

    await setWireStyle(page, 'Bezier')
    await snap(page, '02-free-end-to-free-end-bezier-canvas')

    const ds = await edgePathDs(page, 2)
    for (const d of ds) {
      expect(parseCubic(d), `expected a cubic, got: ${d}`).not.toBeNull()
      expect(d).not.toContain(' L ')
    }
    // The hub->loose-end wire is the one whose chord is diagonal (dy ≈ 110).
    const forked = ds.map(parseCubic).find((c) => c && Math.abs(c.t[1] - c.s[1]) > 50)
    expect(forked).toBeTruthy()
    if (forked) {
      expect(Math.abs(forked.t[0] - forked.s[0]), 'fixture sanity: |dx| > |dy|').toBeGreaterThan(Math.abs(forked.t[1] - forked.s[1]))
      // Departs horizontally, arrives horizontally — not along the chord.
      expect(Math.abs(forked.c1[1] - forked.s[1])).toBeLessThan(0.01)
      expect(forked.c1[0]).toBeGreaterThan(forked.s[0])
      expect(Math.abs(forked.c2[1] - forked.t[1])).toBeLessThan(0.01)
      expect(forked.c2[0]).toBeLessThan(forked.t[0])
    }

    const wires = tikzWireLines(await exportTikz(page, '02-free-end-to-free-end-bezier-export'))
    expect(wires).toHaveLength(2)
    for (const w of wires) {
      expect(w).toContain('.. controls')
      expect(w).not.toMatch(/\) -- \(/)
    }
  })

  test('the angular guard still applies to Step and Straight stays straight — the same off-level free-end wire is a bare segment there', async ({ page }) => {
    const f1 = await addShapeAt(page, 'square', { x: 300, y: 300 })
    await addPointAt(page, f1, ...(SQUARE_SIDES.right))
    const from = await handleCenter(page, f1, 'right:0')
    await dragToFreeEnd(page, from, { x: from.x + 250, y: from.y + 6 })
    await expect(page.locator('.react-flow__edge')).toHaveCount(1)

    await setWireStyle(page, 'Step')
    await snap(page, '03-box-to-free-end-step-canvas')
    let [d] = await edgePathDs(page, 1)
    expect(d).toMatch(/^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/)
    let wires = tikzWireLines(await exportTikz(page, '03-box-to-free-end-step-export'))
    expect(wires).toHaveLength(1)
    expect(wires[0]).toMatch(/\) -- \(/)
    expect(wires[0]).not.toContain('.. controls')

    await setWireStyle(page, 'Straight')
    ;[d] = await edgePathDs(page, 1)
    expect(d).toMatch(/^M [-\d.]+ [-\d.]+ L [-\d.]+ [-\d.]+$/)
    wires = tikzWireLines(await exportTikz(page))
    expect(wires).toHaveLength(1)
    expect(wires[0]).toMatch(/\) -- \(/)
  })
})
