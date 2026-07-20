// Test suite for gesture-driven point insertion (forms.ts's
// insertionIndex/edgeParam + mutations.ts's addPoint splice). Runs under
// Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { insertionIndex } from '../../components/editor/domain/forms'
import { addPoint } from '../../components/editor/domain/mutations'
import type { Diagram, Form } from '../../components/editor/domain/types'

function emptyDiagram(): Diagram {
  return { schemaVersion: 1, forms: [], points: {}, lines: [] }
}

function bareForm(id: string, shape: Form['shape'], extra: Partial<Form> = {}): Form {
  return { id, shape, position: { x: 0, y: 0 }, edges: {}, ...extra }
}

describe('gesture-driven point insertion', () => {
  it("SQUARE — 'right' edge, 1 existing point (index0 sits at ry=0.5)", () => {
    const form = bareForm('F1', 'square', { edges: { right: ['P1'] } })
    const below = insertionIndex(form, 'right', 1, 0.8) // gesture below the existing point
    const above = insertionIndex(form, 'right', 1, 0.2) // gesture above the existing point
    expect(below, `square 'right', 1 point, gesture below center -> index 1 (got ${below})`).toBe(1)
    expect(above, `square 'right', 1 point, gesture above center -> index 0 (got ${above})`).toBe(0)
  })

  it("SQUARE — 'top' edge, 2 existing points (at rx=1/3, 2/3); gesture between them -> index 1", () => {
    const form = bareForm('F2', 'square', { edges: { top: ['P1', 'P2'] } })
    const between = insertionIndex(form, 'top', 0.5, 0)
    expect(between, `square 'top', 2 points, gesture between them -> index 1 (got ${between})`).toBe(1)
    const before = insertionIndex(form, 'top', 0.05, 0)
    const after = insertionIndex(form, 'top', 0.95, 0)
    expect(before, `square 'top', 2 points, gesture near the start -> index 0 (got ${before})`).toBe(0)
    expect(after, `square 'top', 2 points, gesture near the end -> index 2 (got ${after})`).toBe(2)
  })

  it("CIRCLE — 'right' arc (ARC_START = π/4, \"NE\"), 2 existing points", () => {
    const form = bareForm('F3', 'circle', { edges: { right: ['P1', 'P2'] } })
    // Near the arc's start (just past NE, small t): rx/ry near (0.5+0.5cosθ, 0.5-0.5sinθ) at θ ≈ π/4 - ε.
    const thetaStart = Math.PI / 4 - 0.05
    const nearStart = insertionIndex(
      form, 'right',
      0.5 + 0.5 * Math.cos(thetaStart),
      0.5 - 0.5 * Math.sin(thetaStart),
    )
    // Near the arc's end (just before SE, t close to 1): θ ≈ -π/4 + ε.
    const thetaEnd = -Math.PI / 4 + 0.05
    const nearEnd = insertionIndex(
      form, 'right',
      0.5 + 0.5 * Math.cos(thetaEnd),
      0.5 - 0.5 * Math.sin(thetaEnd),
    )
    expect(nearStart, `circle 'right' arc, gesture near NE (arc start) -> index 0 (got ${nearStart})`).toBe(0)
    expect(nearEnd, `circle 'right' arc, gesture near SE (arc end) -> index count=2 (got ${nearEnd})`).toBe(2)
  })

  it("ROTATED SQUARE (90°) — a screen-space point that, once run through the SAME unrotateLocal transform Canvas.tsx uses, lands on the 'right' edge below its existing point", () => {
    // Pure math only (no React/Canvas import) — this mirrors what
    // nodeLocalFraction would produce for a 100x100 rotated node.
    function unrotateLocal(localX: number, localY: number, w: number, h: number, rotationDeg: number): [number, number] {
      if (!rotationDeg) return [localX, localY]
      const theta = (rotationDeg * Math.PI) / 180
      const cx = w / 2, cy = h / 2
      const vx = localX - cx, vy = localY - cy
      const ux = vx * Math.cos(theta) + vy * Math.sin(theta)
      const uy = -vx * Math.sin(theta) + vy * Math.cos(theta)
      return [cx + ux, cy + uy]
    }
    const form = bareForm('F4', 'square', { rotation: 90, edges: { right: ['P1'] } }) // existing point at ry=0.5
    const n = 100
    // Screen-space local point (20, 100) on a 100x100 node rotated 90° unrotates
    // to (100, 80) -> rx=1 (right edge), ry=0.8 (below the existing point's 0.5).
    const [lx, ly] = unrotateLocal(20, 100, n, n, 90)
    const rx = lx / n, ry = ly / n
    expect(
      Math.abs(rx - 1) < 1e-9 && Math.abs(ry - 0.8) < 1e-9,
      `sanity: unrotateLocal(20,100,100,100,90) -> (rx=1, ry=0.8) (got rx=${rx}, ry=${ry})`,
    ).toBe(true)
    const idx = insertionIndex(form, 'right', rx, ry)
    expect(idx, `rotated square (90°): screen-space gesture unrotates to below the existing point -> index 1 (got ${idx})`).toBe(1)
  })

  it('mutations.addPoint — index splice', () => {
    const d = emptyDiagram()
    d.forms.push(bareForm('MF1', 'square', { edges: { top: ['MP1', 'MP2'] } }))
    d.points['MP1'] = { id: 'MP1', shape: 'empty', formId: 'MF1', edgeKey: 'top' }
    d.points['MP2'] = { id: 'MP2', shape: 'empty', formId: 'MF1', edgeKey: 'top' }

    const [d2, newId] = addPoint(d, 'MF1', 'top', 'empty', 1)
    const list = d2.forms.find((f) => f.id === 'MF1')!.edges.top
    expect(
      list[0] === 'MP1' && list[1] === newId && list[2] === 'MP2',
      `addPoint with index=1 splices between existing ids, preserving their relative order (got [${list.join(',')}])`,
    ).toBe(true)
  })

  it('mutations.addPoint — out-of-range index clamps', () => {
    const d = emptyDiagram()
    d.forms.push(bareForm('MF3', 'square', { edges: { top: ['MP1'] } }))
    d.points['MP1'] = { id: 'MP1', shape: 'empty', formId: 'MF3', edgeKey: 'top' }
    const [dLow, idLow] = addPoint(d, 'MF3', 'top', 'empty', -5)
    const listLow = dLow.forms.find((f) => f.id === 'MF3')!.edges.top
    expect(
      listLow[0] === idLow && listLow[1] === 'MP1',
      `negative index clamps to 0 (got [${listLow.join(',')}])`,
    ).toBe(true)

    const [dHigh, idHigh] = addPoint(d, 'MF3', 'top', 'empty', 999)
    const listHigh = dHigh.forms.find((f) => f.id === 'MF3')!.edges.top
    expect(
      listHigh[0] === 'MP1' && listHigh[1] === idHigh,
      `out-of-range index clamps to append (got [${listHigh.join(',')}])`,
    ).toBe(true)
  })

  it('mutations.addPoint — undefined index still appends (default/back-compat behavior)', () => {
    const d = emptyDiagram()
    d.forms.push(bareForm('MF4', 'square', { edges: { top: ['MP1'] } }))
    d.points['MP1'] = { id: 'MP1', shape: 'empty', formId: 'MF4', edgeKey: 'top' }
    const [d2, newId] = addPoint(d, 'MF4', 'top')
    const list = d2.forms.find((f) => f.id === 'MF4')!.edges.top
    expect(list[0] === 'MP1' && list[1] === newId, `addPoint with no index still appends (got [${list.join(',')}])`).toBe(true)
  })
})
