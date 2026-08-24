// Test suite for the triangle's 'peak' point-attachment slot (forms.ts's
// triangleGeometry, mutations.ts's addPoint/removePoint capacity split).
// Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { geometryFor, insertionIndex } from '../../components/editor/domain/forms'
import { addPoint, removePoint } from '../../components/editor/domain/mutations'
import { restoreDiagram } from '../../components/editor/persist/io'
import type { Diagram, Form } from '../../components/editor/domain/types'

function bareForm(id: string, shape: Form['shape'], extra: Partial<Form> = {}): Form {
  return { id, shape, position: { x: 0, y: 0 }, edges: {}, ...extra }
}

describe("triangle 'peak' slot", () => {
  it("forms.ts's triangleGeometry declares edgeCapacity.peak=1, NOT pointIsForm", () => {
    const geom = geometryFor('triangle')
    expect(geom.edgeKeys.includes('peak'), `triangle's edgeKeys include 'peak' (got [${geom.edgeKeys.join(',')}])`).toBe(true)
    expect(geom.edgeCapacity?.peak, `triangle declares edgeCapacity.peak=1`).toBe(1)
    expect(geom.pointIsForm, `triangle does NOT declare pointIsForm (the peak point is optional, not the form itself)`).toBeFalsy()
  })

  it('mutations.addPoint — capacity reuse at peak (2nd addPoint returns the first id)', () => {
    const d: Diagram = { schemaVersion: 1, forms: [bareForm('T1', 'triangle')], points: {}, lines: [] }
    const [d1, id1] = addPoint(d, 'T1', 'peak')
    expect(id1 !== '', `first addPoint on the peak creates a point (got id=${JSON.stringify(id1)})`).toBe(true)
    const list1 = d1.forms.find((f) => f.id === 'T1')!.edges.peak
    expect(list1.length === 1 && list1[0] === id1, `peak holds exactly the one point after the first drop`).toBe(true)

    const [d2, id2] = addPoint(d1, 'T1', 'peak')
    expect(id2, `a SECOND addPoint on the peak REUSES the existing point (got id2=${id2}, id1=${id1})`).toBe(id1)
    const list2 = d2.forms.find((f) => f.id === 'T1')!.edges.peak
    expect(list2.length === 1 && list2[0] === id1, `still exactly one point after the second drop`).toBe(true)
  })

  it('mutations.removePoint on the peak point leaves the triangle intact (regression vs the empty-form cascade)', () => {
    const d: Diagram = { schemaVersion: 1, forms: [bareForm('T2', 'triangle')], points: {}, lines: [] }
    const [d1, peakId] = addPoint(d, 'T2', 'peak')
    const after = removePoint(d1, peakId)
    expect(after.forms.find((f) => f.id === 'T2'), `the triangle SURVIVES deleting its peak point`).not.toBeUndefined()
    expect(after.points[peakId], `the peak point itself is gone`).toBeUndefined()
    const list = after.forms.find((f) => f.id === 'T2')!.edges.peak ?? []
    expect(list.length, `peak's edge list is empty again`).toBe(0)
  })

  it("forms.ts's triangleGeometry — pointAnchor('peak') sits at the apex vertex", () => {
    const geom = geometryFor('triangle')
    const n = 100
    const a = geom.pointAnchor('peak', 0, 1, n)
    // TRI_APEX_X = 1.0, TRI_APEX_Y = 0.5 (see forms.ts) — the triangle is
    // inscribed in the circumradius-0.5 circle centred at (0.5, 0.5), so the
    // apex sits exactly on the box's right edge.
    const apexX = 1.0 * n
    const apexY = 0.5 * n
    expect(Math.abs(a.x - apexX) < 1e-9 && Math.abs(a.y - apexY) < 1e-9, `peak anchor sits at the apex vertex (got x=${a.x}, y=${a.y}, want x=${apexX}, y=${apexY})`).toBe(true)
    // Even with an out-of-model index/count the anchor never fans — always the apex.
    const a2 = geom.pointAnchor('peak', 3, 7, n)
    expect(Math.abs(a2.x - apexX) < 1e-9 && Math.abs(a2.y - apexY) < 1e-9, `peak anchor stays at the apex regardless of index/count`).toBe(true)
  })

  it("forms.ts's triangleGeometry — edgeAt near the apex resolves 'peak', mid-side resolves the side", () => {
    const geom = geometryFor('triangle')
    // Apex fraction coords: TRI_APEX_X = 1.0, TRI_APEX_Y = 0.5 — the
    // triangle is inscribed in the circumradius-0.5 circle at (0.5, 0.5).
    const apexX = 1.0
    const nearApex = geom.edgeAt(apexX - 0.01, 0.5)
    expect(nearApex, `a cursor right at the apex resolves to 'peak' (got ${nearApex})`).toBe('peak')

    // Mid-side 'a' (top slant): roughly halfway between the base's top vertex
    // (TRI_BASE_X=0.25, TRI_BASE_Y_TOP=0.5-sqrt(3)/4) and the apex, well
    // outside PEAK_R.
    const baseX = 0.25
    const baseYTop = 0.5 - Math.sqrt(3) / 4
    const midA = geom.edgeAt((baseX + apexX) / 2, (baseYTop + 0.5) / 2)
    expect(midA, `a cursor mid-way along side 'a' resolves to 'a', not 'peak' (got ${midA})`).toBe('a')

    // Side 'c' (left vertical side) — nowhere near the apex.
    const midC = geom.edgeAt(baseX, 0.5)
    expect(midC, `a cursor on side 'c' resolves to 'c' (got ${midC})`).toBe('c')
  })

  it("forms.ts — insertionIndex('peak') is always 0 (capacity-1 edge)", () => {
    const form = bareForm('T3', 'triangle')
    const idx = insertionIndex(form, 'peak', 0.9, 0.5)
    expect(idx, `insertionIndex for an empty peak edge is 0 (got ${idx})`).toBe(0)
  })

  it('io.ts — round-trip of a triangle with a peak point', () => {
    const original: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'RT', shape: 'triangle', position: { x: 0, y: 0 }, edges: { a: [], b: [], c: [], peak: ['PK'], 'corner-base-top': [], 'corner-base-bottom': [], 'center': [] } }],
      points: { PK: { id: 'PK', shape: 'circle', name: 'top', formId: 'RT', edgeKey: 'peak' } },
      lines: [],
    }
    const restored = restoreDiagram(original)
    expect(restored.forms.find((f) => f.id === 'RT')!.edges.peak, `peak edge round-trips with its point id`).toEqual(['PK'])
    expect(restored.points.PK?.shape, `the peak point's shape round-trips unchanged`).toBe('circle')
    expect(restored.points.PK?.name, `the peak point's name round-trips unchanged`).toBe('top')
    expect(JSON.stringify(restored), `the whole diagram round-trips byte-for-byte unchanged`).toBe(JSON.stringify(original))
  })

  it("io.ts — CORNER_KEY_RE (/^v\\d+$/) does not match 'peak', so a saved peak point survives restoreDiagram's legacy-corner drop", () => {
    const raw = {
      schemaVersion: 1,
      forms: [{ id: 'RT2', shape: 'triangle', position: { x: 0, y: 0 }, edges: { a: [], b: [], c: [], peak: ['PK2'] } }],
      points: { PK2: { id: 'PK2', shape: 'empty', formId: 'RT2', edgeKey: 'peak' } },
      lines: [],
    }
    const restored = restoreDiagram(raw)
    expect(restored.forms.find((f) => f.id === 'RT2')!.edges.peak, `peak point is NOT dropped as a legacy corner`).toEqual(['PK2'])
    expect(restored.points.PK2, `the peak point itself survives`).not.toBeUndefined()
  })
})
