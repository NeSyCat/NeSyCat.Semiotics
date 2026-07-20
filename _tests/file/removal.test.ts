// Test suite for the two coupled breaking removals — CORNER POINTS
// (Form.corners, per-kind vertex slots) and the 'point' FormKind (a
// standalone dot-bodied form). Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { geometryFor, formRegistry } from '../../components/editor/forms'
import { addPoint } from '../../components/editor/mutations'
import { restoreDiagram } from '../../components/editor/io'
import type { Diagram, Form, Shape } from '../../components/editor/types'

function bareForm(id: string, kind: Form['kind'], extra: Partial<Form> = {}): Form {
  return { id, kind, position: { x: 0, y: 0 }, edges: {}, ...extra }
}

const REMAINING_KINDS: Shape[] = ['triangle', 'square', 'circle', 'rhombus', 'empty']

describe('corner points and point-kind form removal', () => {
  it('(i) no geometry exposes corner keys', () => {
    expect(
      Object.keys(formRegistry).sort().join(','),
      `formRegistry has exactly the 5 remaining kinds, no 'point' (got [${Object.keys(formRegistry).join(',')}])`,
    ).toBe([...REMAINING_KINDS].sort().join(','))
    for (const kind of REMAINING_KINDS) {
      const geom = geometryFor(kind)
      const cornerKeys = geom.edgeKeys.filter((k) => /^v\d+$/.test(k))
      expect(cornerKeys.length, `${kind}'s edgeKeys contain no 'v#' corner key (got [${geom.edgeKeys.join(',')}])`).toBe(0)
      expect('corners' in geom, `${kind}'s geometry object has no 'corners' field`).toBe(false)
    }
  })

  it("(ii) restoreDiagram DROPS a 'point'-kind form + its points + prunes their lines", () => {
    const raw = {
      schemaVersion: 1,
      forms: [
        { id: 'SQ', kind: 'square', position: { x: 0, y: 0 }, edges: { top: ['PA'] } },
        { id: 'PT', kind: 'point', position: { x: 300, y: 0 }, edges: { self: ['P1', 'P2'] } },
      ],
      points: {
        PA: { id: 'PA', shape: 'point', formId: 'SQ', edgeKey: 'top' },
        P1: { id: 'P1', shape: 'point', formId: 'PT', edgeKey: 'self' },
        P2: { id: 'P2', shape: 'point', formId: 'PT', edgeKey: 'self' },
      },
      lines: [
        { id: 'L1', source: 'PA', targets: ['P1'] }, // touches the dropped form -> pruned
        { id: 'L2', source: 'P1', targets: ['P2'] }, // both ends dropped -> pruned
      ],
    }
    const d = restoreDiagram(raw)
    expect(
      d.forms.length === 1 && d.forms[0].id === 'SQ',
      `the 'point'-kind form is dropped entirely (got forms=[${d.forms.map((f) => f.id).join(',')}])`,
    ).toBe(true)
    expect(d.points.P1 === undefined && d.points.P2 === undefined, `the dropped form's points (P1, P2) are gone`).toBe(true)
    expect(d.points.PA !== undefined, `the surviving form's own point (PA) is untouched`).toBe(true)
    expect(d.lines.length, `every Line referencing a dropped point is pruned (got ${d.lines.length})`).toBe(0)
  })

  it('(iii) restoreDiagram DROPS corner points (old `corners` map)', () => {
    const raw = {
      schemaVersion: 1,
      forms: [
        {
          id: 'SQ2', kind: 'square', position: { x: 0, y: 0 },
          edges: { top: ['PS'] }, corners: { v0: 'PC' },
        },
      ],
      points: {
        PS: { id: 'PS', shape: 'point', formId: 'SQ2', edgeKey: 'top' },
        PC: { id: 'PC', shape: 'point', formId: 'SQ2', edgeKey: 'v0' },
      },
      lines: [{ id: 'L3', source: 'PS', targets: ['PC'] }],
    }
    const d = restoreDiagram(raw)
    expect(d.forms.length === 1 && d.forms[0].id === 'SQ2', `the form itself survives (only the corner point is dropped)`).toBe(true)
    expect(d.points.PC, `the corner point (PC) is gone`).toBeUndefined()
    expect(d.points.PS !== undefined, `the surviving side point (PS) is untouched`).toBe(true)
    const sq2 = d.forms[0]
    expect(sq2.edges.top?.[0], `the side's own point list is intact (got [${(sq2.edges.top ?? []).join(',')}])`).toBe('PS')
    expect('corners' in sq2, `the restored form carries no 'corners' field at all`).toBe(false)
    expect(d.lines.length, `the line into the dropped corner point is pruned (got ${d.lines.length})`).toBe(0)
  })

  it("(iii-b) restoreDiagram DROPS corner points identified ONLY by their own edgeKey (old-old data: no separate `corners` map, the point just sits in `edges['v0']`) — robust to storage format", () => {
    const raw = {
      schemaVersion: 1,
      forms: [
        { id: 'SQ3', kind: 'square', position: { x: 0, y: 0 }, edges: { top: ['PS2'], v0: ['PC2'] } },
      ],
      points: {
        PS2: { id: 'PS2', shape: 'point', formId: 'SQ3', edgeKey: 'top' },
        PC2: { id: 'PC2', shape: 'point', formId: 'SQ3', edgeKey: 'v0' },
      },
      lines: [{ id: 'L4', source: 'PS2', targets: ['PC2'] }],
    }
    const d = restoreDiagram(raw)
    expect(d.points.PC2, `a point whose OWN edgeKey looks like 'v0' is dropped even with no separate corners map`).toBeUndefined()
    expect(d.points.PS2 !== undefined, `the real side point survives`).toBe(true)
    expect(d.lines.length, `the line into it is pruned`).toBe(0)
  })

  it('(iv) both drops are idempotent and compose with the empty-form collapse pass in ONE load', () => {
    const raw = {
      schemaVersion: 1,
      forms: [
        { id: 'SQ4', kind: 'square', position: { x: 0, y: 0 }, edges: { top: ['PA4'] }, corners: { v0: 'PC4' } },
        { id: 'PT4', kind: 'point', position: { x: 300, y: 0 }, edges: { self: ['P14', 'P24'] } },
        { id: 'E4', kind: 'empty', position: { x: 600, y: 0 }, edges: { self: ['Q14', 'Q24'] } },
      ],
      points: {
        PA4: { id: 'PA4', shape: 'point', formId: 'SQ4', edgeKey: 'top' },
        PC4: { id: 'PC4', shape: 'point', formId: 'SQ4', edgeKey: 'v0' },
        P14: { id: 'P14', shape: 'point', formId: 'PT4', edgeKey: 'self' },
        P24: { id: 'P24', shape: 'point', formId: 'PT4', edgeKey: 'self' },
        Q14: { id: 'Q14', shape: 'point', formId: 'E4', edgeKey: 'self' },
        Q24: { id: 'Q24', shape: 'point', formId: 'E4', edgeKey: 'self' },
      },
      lines: [
        { id: 'L5', source: 'PA4', targets: ['PC4'] }, // corner point pruned
        { id: 'L6', source: 'P14', targets: ['P24'] }, // point-kind form pruned
        { id: 'L7', source: 'PA4', targets: ['Q14'] }, // Q14 survives (remapped by empty-collapse)
        { id: 'L8', source: 'PA4', targets: ['Q24'] }, // Q24 collapses onto Q14
      ],
    }
    const d = restoreDiagram(raw)
    expect(
      d.forms.length,
      `both the 'point'-kind form is dropped and the corner point's form kept (got forms=[${d.forms.map((f) => f.id).join(',')}])`,
    ).toBe(2)
    expect(d.forms.find((f) => f.id === 'PT4'), `'point'-kind form PT4 dropped`).toBeUndefined()
    const sq4 = d.forms.find((f) => f.id === 'SQ4')!
    expect(sq4.edges.top?.[0], `SQ4's side point survives`).toBe('PA4')
    expect(
      d.points.PC4 === undefined && d.points.P14 === undefined && d.points.P24 === undefined,
      `all removed-shape points are gone`,
    ).toBe(true)
    const e4 = d.forms.find((f) => f.id === 'E4')!
    expect(e4.edges.self.length, `the empty-form collapse still runs on the SAME load (Q14/Q24 -> 1 point, got [${e4.edges.self.join(',')}])`).toBe(1)
    expect(d.lines.length, `L5/L6 pruned (touched removed points); L7/L8 collapse onto the SAME kept empty-point and survive (got ${d.lines.length})`).toBe(2)

    // Idempotent: feeding the already-restored diagram back through is a no-op.
    const d2 = restoreDiagram(d)
    expect(JSON.stringify(d2), `re-running restoreDiagram on its own output is a no-op (idempotent)`).toBe(JSON.stringify(d))
  })

  it('(v) addPoint on a side still works (regression)', () => {
    const d: Diagram = { schemaVersion: 1, forms: [bareForm('S1', 'square')], points: {}, lines: [] }
    const [d1, id1] = addPoint(d, 'S1', 'top')
    expect(id1 !== '', `addPoint on a normal side still creates a point (got id=${JSON.stringify(id1)})`).toBe(true)
    expect(
      d1.forms.find((f) => f.id === 'S1')!.edges.top?.[0],
      `the new point lands in the side's edge list (got [${(d1.forms.find((f) => f.id === 'S1')!.edges.top ?? []).join(',')}])`,
    ).toBe(id1)
    // A corner-shaped key ('v0') is no longer special-cased — it's just an
    // edge key the current geometry doesn't declare, so it falls back to an
    // ordinary (unbounded) side list rather than the old single-slot semantics.
    const [d2, id2a] = addPoint(d1, 'S1', 'v0')
    const [d3, id2b] = addPoint(d2, 'S1', 'v0')
    expect(id2a !== id2b, `an edge key like 'v0' has no single-slot special-casing anymore — two adds create two distinct points`).toBe(true)
    expect((d3.forms.find((f) => f.id === 'S1')!.edges.v0 ?? []).length, `both land in an ordinary (unbounded) list under that key`).toBe(2)
  })

  it('(vi) a normal diagram round-trips unchanged', () => {
    const raw: Diagram = {
      schemaVersion: 1,
      forms: [
        { id: 'RT1', kind: 'square', position: { x: 10, y: 20 }, edges: { top: ['RP1'], right: [], bottom: [], left: [] } },
        { id: 'RT2', kind: 'circle', position: { x: 300, y: 20 }, edges: { up: [], right: [], down: [], left: ['RP2'] } },
      ],
      points: {
        RP1: { id: 'RP1', shape: 'circle', name: 'x', formId: 'RT1', edgeKey: 'top' },
        RP2: { id: 'RP2', shape: 'empty', formId: 'RT2', edgeKey: 'left' },
      },
      lines: [{ id: 'RL1', name: 'f', source: 'RP1', targets: ['RP2'] }],
    }
    const restored = restoreDiagram(raw)
    expect(JSON.stringify(restored), `a normal diagram with no removed shapes round-trips byte-for-byte unchanged`).toBe(JSON.stringify(raw))
    const restoredAgain = restoreDiagram(restored)
    expect(JSON.stringify(restoredAgain), `...and stays unchanged on a second restore (idempotent)`).toBe(JSON.stringify(restored))
  })
})
