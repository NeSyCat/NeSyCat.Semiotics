// Test suite for the two coupled breaking removals — CORNER POINTS
// (Form.corners, per-shape vertex slots) and the 'point' Form shape (a
// standalone dot-bodied form) — plus io.ts's kind->shape read shim (Phase C:
// saved diagrams may still carry the old `kind` field name; canonForm reads
// `f.shape ?? f.kind`, and dropRemovedShapes' own 'point'-shape check reads
// both spellings since it runs on RAW pre-canon data). Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { geometryFor, formRegistry } from '../../components/editor/domain/forms'
import { addPoint } from '../../components/editor/domain/mutations'
import { restoreDiagram } from '../../components/editor/persist/io'
import type { Diagram, Form, Shape } from '../../components/editor/domain/types'

function bareForm(id: string, shape: Form['shape'], extra: Partial<Form> = {}): Form {
  return { id, shape, position: { x: 0, y: 0 }, edges: {}, ...extra }
}

const REMAINING_SHAPES: Shape[] = ['triangle', 'square', 'circle', 'rhombus', 'empty']

describe('corner points and point-shape form removal', () => {
  it('(i) no geometry exposes corner keys', () => {
    expect(
      Object.keys(formRegistry).sort().join(','),
      `formRegistry has exactly the 5 remaining shapes, no 'point' (got [${Object.keys(formRegistry).join(',')}])`,
    ).toBe([...REMAINING_SHAPES].sort().join(','))
    for (const shape of REMAINING_SHAPES) {
      const geom = geometryFor(shape)
      const cornerKeys = geom.edgeKeys.filter((k) => /^v\d+$/.test(k))
      expect(cornerKeys.length, `${shape}'s edgeKeys contain no 'v#' corner key (got [${geom.edgeKeys.join(',')}])`).toBe(0)
      expect('corners' in geom, `${shape}'s geometry object has no 'corners' field`).toBe(false)
    }
  })

  it("(ii) restoreDiagram DROPS a 'point'-shape form (legacy raw `kind` field) + its points + prunes their lines", () => {
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
      `the 'point'-shape form is dropped entirely (got forms=[${d.forms.map((f) => f.id).join(',')}])`,
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
      `both the 'point'-shape form is dropped and the corner point's form kept (got forms=[${d.forms.map((f) => f.id).join(',')}])`,
    ).toBe(2)
    expect(d.forms.find((f) => f.id === 'PT4'), `'point'-shape form PT4 dropped`).toBeUndefined()
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
        { id: 'RT1', shape: 'square', position: { x: 10, y: 20 }, edges: { top: ['RP1'], right: [], bottom: [], left: [] } },
        { id: 'RT2', shape: 'circle', position: { x: 300, y: 20 }, edges: { up: [], right: [], down: [], left: ['RP2'] } },
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

// ── kind -> shape read shim (Phase C) ───────────────────────────────────
// canonForm reads `f.shape ?? f.kind` — new field preferred, old accepted —
// so every diagram saved before this rename keeps loading. Everything
// WRITTEN from now on (JSON.stringify of a restored Diagram, e.g. via
// share.ts's encodeDiagramToFragment or the DB autosave path) uses `shape`
// only; there is no write-shim, and Form itself no longer has a `kind` field
// at all (canonForm's own output is always `{ shape, ... }`).
describe('io.ts kind -> shape read shim', () => {
  it('a raw form with `shape` only (current format) loads correctly', () => {
    const raw = {
      schemaVersion: 1,
      forms: [{ id: 'A', shape: 'triangle', position: { x: 0, y: 0 }, edges: { a: [], b: [], c: [] } }],
      points: {}, lines: [],
    }
    const d = restoreDiagram(raw)
    expect(d.forms[0].shape, `shape-only raw form loads with the right shape (got ${d.forms[0].shape})`).toBe('triangle')
  })

  it('a raw form with `kind` only (legacy format) loads correctly via the shim', () => {
    const raw = {
      schemaVersion: 1,
      forms: [{ id: 'B', kind: 'rhombus', position: { x: 0, y: 0 }, edges: { 'top-right': [], 'bottom-right': [], 'bottom-left': [], 'top-left': [] } }],
      points: {}, lines: [],
    }
    const d = restoreDiagram(raw)
    expect(d.forms[0].shape, `kind-only raw form loads via the shim, landing on Form.shape (got ${d.forms[0].shape})`).toBe('rhombus')
    expect('kind' in d.forms[0], `the restored Form carries no 'kind' field at all — only 'shape'`).toBe(false)
  })

  it('`shape` wins over `kind` when a raw form somehow carries both (new field preferred)', () => {
    const raw = {
      schemaVersion: 1,
      forms: [{ id: 'C', shape: 'circle', kind: 'square', position: { x: 0, y: 0 }, edges: { up: [], right: [], down: [], left: [] } }],
      points: {}, lines: [],
    }
    const d = restoreDiagram(raw)
    expect(d.forms[0].shape, `shape ('circle') wins over the stale kind ('square') (got ${d.forms[0].shape})`).toBe('circle')
  })

  it("the legacy 'point'-shape drop still works via BOTH field spellings (dropRemovedShapes reads raw, pre-canon data)", () => {
    const rawKindSpelling = {
      schemaVersion: 1,
      forms: [
        { id: 'SQ5', kind: 'square', position: { x: 0, y: 0 }, edges: { top: ['PA5'] } },
        { id: 'PT5', kind: 'point', position: { x: 300, y: 0 }, edges: { self: ['P15'] } },
      ],
      points: {
        PA5: { id: 'PA5', shape: 'point', formId: 'SQ5', edgeKey: 'top' },
        P15: { id: 'P15', shape: 'point', formId: 'PT5', edgeKey: 'self' },
      },
      lines: [],
    }
    const dKind = restoreDiagram(rawKindSpelling)
    expect(dKind.forms.length, `old-spelling 'kind: point' form is dropped (got forms=[${dKind.forms.map((f) => f.id).join(',')}])`).toBe(1)
    expect(dKind.forms[0].id, `only the surviving square remains`).toBe('SQ5')
    expect(dKind.points.P15, `the dropped point-shape form's own point is gone too`).toBeUndefined()

    const rawShapeSpelling = {
      schemaVersion: 1,
      forms: [
        { id: 'SQ6', shape: 'square', position: { x: 0, y: 0 }, edges: { top: ['PA6'] } },
        { id: 'PT6', shape: 'point', position: { x: 300, y: 0 }, edges: { self: ['P16'] } },
      ],
      points: {
        PA6: { id: 'PA6', shape: 'point', formId: 'SQ6', edgeKey: 'top' },
        P16: { id: 'P16', shape: 'point', formId: 'PT6', edgeKey: 'self' },
      },
      lines: [],
    }
    const dShape = restoreDiagram(rawShapeSpelling)
    expect(dShape.forms.length, `new-spelling 'shape: point' form is ALSO dropped (got forms=[${dShape.forms.map((f) => f.id).join(',')}])`).toBe(1)
    expect(dShape.forms[0].id, `only the surviving square remains`).toBe('SQ6')
    expect(dShape.points.P16, `the dropped point-shape form's own point is gone too`).toBeUndefined()
  })

  it('DATA-PATH PROOF: a diagram saved pre-rename (raw `kind`) round-trips — load resolves the right shapes, and re-encoding (JSON.stringify, same as share.ts) writes `shape`, never `kind`', () => {
    const legacySave = {
      schemaVersion: 1,
      forms: [
        { id: 'L1', kind: 'triangle', position: { x: 0, y: 0 }, edges: { a: ['LP1'], b: [], c: [] } },
        { id: 'L2', kind: 'empty', position: { x: 300, y: 0 }, edges: { self: ['LP2'] } },
      ],
      points: {
        LP1: { id: 'LP1', shape: 'square', name: 'x', formId: 'L1', edgeKey: 'a' },
        LP2: { id: 'LP2', shape: 'empty', formId: 'L2', edgeKey: 'self' },
      },
      lines: [{ id: 'LL1', source: 'LP1', targets: ['LP2'] }],
    }
    const loaded = restoreDiagram(legacySave)
    expect(loaded.forms.find((f) => f.id === 'L1')?.shape, `loads the triangle's shape correctly from the legacy 'kind' field`).toBe('triangle')
    expect(loaded.forms.find((f) => f.id === 'L2')?.shape, `loads the empty carrier's shape correctly from the legacy 'kind' field`).toBe('empty')

    // Re-encode exactly like share.ts's encodeDiagramToFragment does
    // (JSON.stringify(diagram)) — and like the autosave path persists to the
    // DB. The output must carry `shape`, never `kind`.
    const reencoded = JSON.stringify(loaded)
    expect(reencoded.includes('"shape":"triangle"'), `re-encoded JSON writes the new field name 'shape' (got: ${reencoded})`).toBe(true)
    expect(reencoded.includes('"kind"'), `re-encoded JSON carries NO 'kind' field anywhere — the shim is read-only, nothing writes the old name`).toBe(false)

    // And it loads right back the same way, byte for byte.
    const reloaded = restoreDiagram(JSON.parse(reencoded))
    expect(JSON.stringify(reloaded), `the re-encoded (shape-only) save round-trips byte-for-byte through restoreDiagram again`).toBe(reencoded)
  })
})
