// Test suite for the simplified 'empty' FormKind — capacity reuse
// (mutations.ts's addPoint), the constant-center anchor (forms.ts's
// emptyGeometry), and the old-diagram collapse (io.ts's restoreDiagram).
// Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { geometryFor } from '../../components/editor/forms'
import { addPoint, addForm, removePoint } from '../../components/editor/mutations'
import { useStore, initStore } from '../../components/editor/store'
import { restoreDiagram } from '../../components/editor/io'
import type { Diagram, Form } from '../../components/editor/types'

function bareForm(id: string, kind: Form['kind'], extra: Partial<Form> = {}): Form {
  return { id, kind, position: { x: 0, y: 0 }, edges: {}, ...extra }
}

describe("'empty' FormKind", () => {
  it('mutations.addPoint — capacity reuse (many drops, one point)', () => {
    const d: Diagram = { schemaVersion: 1, forms: [bareForm('E1', 'empty')], points: {}, lines: [] }

    const [d1, id1] = addPoint(d, 'E1', 'self')
    expect(id1 !== '', `first addPoint on an empty form creates a point (got id=${JSON.stringify(id1)})`).toBe(true)
    const list1 = d1.forms.find((f) => f.id === 'E1')!.edges.self
    expect(list1.length === 1 && list1[0] === id1, `empty form holds exactly the one middle point after the first drop (got [${list1.join(',')}])`).toBe(true)

    const [d2, id2] = addPoint(d1, 'E1', 'self')
    expect(id2, `a SECOND addPoint on the same empty form REUSES the existing middle point (got id2=${id2}, id1=${id1})`).toBe(id1)
    const list2 = d2.forms.find((f) => f.id === 'E1')!.edges.self
    expect(list2.length === 1 && list2[0] === id1, `still exactly one point after the second drop (got [${list2.join(',')}])`).toBe(true)

    const [d3, id3] = addPoint(d2, 'E1', 'self')
    expect(id3, `a THIRD addPoint still reuses the same point — many lines, one point (got id3=${id3})`).toBe(id1)
    expect(d3.forms.find((f) => f.id === 'E1')!.edges.self.length, `still exactly one point after a third drop`).toBe(1)
  })

  it("forms.ts's emptyGeometry — constant center anchor, any index/count", () => {
    const geom = geometryFor('empty')
    const n = 100
    const a0 = geom.pointAnchor('self', 0, 1, n)
    expect(a0.x === n / 2 && a0.y === n / 2, `empty's middle point sits dead-center for (index=0, count=1) (got x=${a0.x}, y=${a0.y})`).toBe(true)
    // Even for an out-of-model count/index (e.g. mid-load, before io.ts's own
    // collapse normalization runs) the anchor never fans — always the center.
    const a1 = geom.pointAnchor('self', 2, 5, n)
    expect(a1.x === n / 2 && a1.y === n / 2, `empty's anchor stays centered even for (index=2, count=5) (got x=${a1.x}, y=${a1.y})`).toBe(true)
    expect(geom.maxPoints, `empty declares maxPoints=1`).toBe(1)
    expect(
      geom.nodeSize(bareForm('E', 'empty', { edges: { self: ['P1'] } })),
      `empty's nodeSize never grows with point count`,
    ).toBe(geom.nodeSize(bareForm('E', 'empty')))
  })

  it("io.ts's restoreDiagram — collapses an old fanned empty form to 1 point", () => {
    const raw = {
      schemaVersion: 1,
      forms: [
        { id: 'A', kind: 'square', position: { x: 0, y: 0 }, edges: { top: ['PA'] }, corners: {} },
        { id: 'E', kind: 'empty', position: { x: 200, y: 0 }, edges: { self: ['P1', 'P2'] }, corners: {} },
      ],
      points: {
        PA: { id: 'PA', shape: 'empty', formId: 'A', edgeKey: 'top' },
        P1: { id: 'P1', shape: 'empty', formId: 'E', edgeKey: 'self' },
        P2: { id: 'P2', shape: 'empty', formId: 'E', edgeKey: 'self' },
      },
      lines: [
        { id: 'L1', source: 'PA', targets: ['P1'] },
        { id: 'L2', source: 'PA', targets: ['P2'] },
      ],
    }
    const d = restoreDiagram(raw)
    const eForm = d.forms.find((f) => f.id === 'E')!
    expect(eForm.edges.self.length, `restoreDiagram collapses the empty form's 2 points to 1 (got [${eForm.edges.self.join(',')}])`).toBe(1)
    const kept = eForm.edges.self[0]
    expect(kept, `keeps the FIRST point id (got ${kept})`).toBe('P1')
    expect(d.points.P2, `the dropped point (P2) is deleted — no dangling reference`).toBeUndefined()
    expect(Object.keys(d.points).length, `only the kept point + the untouched one remain (got [${Object.keys(d.points).join(',')}])`).toBe(2)
    const l1 = d.lines.find((l) => l.id === 'L1')!
    const l2 = d.lines.find((l) => l.id === 'L2')!
    expect(l1.targets[0], `L1 (already pointing at the kept id) is unchanged (got ${l1.targets[0]})`).toBe(kept)
    expect(l2.targets[0], `L2 (pointed at the dropped id) is re-pointed to the kept id (got ${l2.targets[0]})`).toBe(kept)
    expect(d.lines.length, `no line was lost — both still meet in the middle (got ${d.lines.length})`).toBe(2)

    // Idempotent: collapsing an already-collapsed diagram is a no-op.
    const d2 = restoreDiagram(d)
    expect(JSON.stringify(d2), `re-running restoreDiagram on its own output is a no-op (idempotent)`).toBe(JSON.stringify(d))
  })

  it('io.ts — degenerate-line handling: a line collapsing onto its own source (both ends land on the SAME kept middle point) is dropped, not kept as a self-loop', () => {
    const raw = {
      schemaVersion: 1,
      forms: [{ id: 'E2', kind: 'empty', position: { x: 0, y: 0 }, edges: { self: ['Q1', 'Q2'] }, corners: {} }],
      points: {
        Q1: { id: 'Q1', shape: 'empty', formId: 'E2', edgeKey: 'self' },
        Q2: { id: 'Q2', shape: 'empty', formId: 'E2', edgeKey: 'self' },
      },
      lines: [{ id: 'L3', source: 'Q1', targets: ['Q2'] }], // both ends on the same (soon-to-collapse) form
    }
    const d = restoreDiagram(raw)
    expect(d.forms.find((f) => f.id === 'E2')!.edges.self.length, `the empty form still collapses to 1 point even though its only line disappears`).toBe(1)
    expect(d.lines.find((l) => l.id === 'L3'), `a line whose source and only target collapse onto the SAME kept point is dropped (degenerate self-loop)`).toBeUndefined()
    expect(d.points.Q1 !== undefined && d.points.Q2 === undefined, `Q1 (kept) survives, Q2 (dropped) doesn't`).toBe(true)
  })

  it('STORE: capacity reuse must not push a phantom undo step', () => {
    // addPoint's reuse on a full 'empty' form returns the SAME diagram object;
    // setCur's identity guard must skip history so the next undo isn't a
    // visual no-op. Exercised through the real zustand store (works headless).
    const d: Diagram = { schemaVersion: 1, forms: [bareForm('SE1', 'empty')], points: {}, lines: [] }
    initStore(d)
    const first = useStore.getState().addPoint('SE1', 'self')
    const afterFirst = useStore.getState().historyIndex
    const second = useStore.getState().addPoint('SE1', 'self')
    expect(second, `store addPoint reuse returns the existing id (got ${second}, want ${first})`).toBe(first)
    expect(
      useStore.getState().historyIndex,
      `capacity reuse pushes NO history entry (historyIndex stayed ${afterFirst}, got ${useStore.getState().historyIndex})`,
    ).toBe(afterFirst)
    useStore.getState().undo()
    expect(
      (useStore.getState().diagram.forms.find((f) => f.id === 'SE1')!.edges.self ?? []).length,
      'one undo after two drops removes the point (no phantom no-op step in between)',
    ).toBe(0)
  })

  it('mutations.addForm — seeds the middle point for capacity-bearing kinds', () => {
    // (the ticket's "when I drag an empty form onto the canvas it should
    // already have a name point" request), in ONE returned Diagram — one undo
    // step covers form + point together.
    const empty: Diagram = { schemaVersion: 1, forms: [], points: {}, lines: [] }

    // (i) addForm('empty') seeds exactly one point on 'self', shape 'empty'.
    const [d1, formId1] = addForm(empty, 'empty', { x: 0, y: 0 })
    const form1 = d1.forms.find((f) => f.id === formId1)!
    const seededIds = form1.edges.self ?? []
    expect(seededIds.length, `addForm('empty') seeds exactly one point id on 'self' (got [${seededIds.join(',')}])`).toBe(1)
    const seededPoint = d1.points[seededIds[0]]
    expect(seededPoint !== undefined, `the seeded point id actually exists in points{} (got ${seededIds[0]})`).toBe(true)
    expect(seededPoint?.shape, `the seeded point uses addPoint's default shape 'empty' (got ${seededPoint?.shape})`).toBe('empty')
    expect(
      seededPoint?.formId === formId1 && seededPoint?.edgeKey === 'self',
      `the seeded point is attached to the new form's 'self' edge (got formId=${seededPoint?.formId}, edgeKey=${seededPoint?.edgeKey})`,
    ).toBe(true)

    // (ii) addForm for a kind with no maxPoints (e.g. 'square') seeds nothing.
    const [d2, formId2] = addForm(empty, 'square', { x: 0, y: 0 })
    const form2 = d2.forms.find((f) => f.id === formId2)!
    const squareEdgeCounts = Object.values(form2.edges).map((l) => l.length)
    expect(squareEdgeCounts.every((n) => n === 0), `addForm('square') seeds NO points on any side (got edges=${JSON.stringify(form2.edges)})`).toBe(true)
    expect(Object.keys(d2.points).length, `'square' creation adds no entries to points{} (got ${Object.keys(d2.points).length})`).toBe(0)

    // (iii) store-level: create → historyIndex advances by exactly ONE; one
    // undo removes form AND point together.
    initStore(empty)
    const beforeIndex = useStore.getState().historyIndex
    const createdId = useStore.getState().addForm('empty', { x: 0, y: 0 })
    const afterIndex = useStore.getState().historyIndex
    expect(afterIndex, `store.addForm('empty') advances historyIndex by exactly ONE (was ${beforeIndex}, now ${afterIndex})`).toBe(beforeIndex + 1)
    const createdForm = useStore.getState().diagram.forms.find((f) => f.id === createdId)!
    const createdPtIds = createdForm.edges.self ?? []
    expect(
      createdPtIds.length === 1 && useStore.getState().diagram.points[createdPtIds[0]] !== undefined,
      `store.addForm('empty') diagram already has the form's middle point (got [${createdPtIds.join(',')}])`,
    ).toBe(true)
    useStore.getState().undo()
    const afterUndo = useStore.getState().diagram
    expect(afterUndo.forms.find((f) => f.id === createdId), `one undo removes the seeded form (got forms=[${afterUndo.forms.map((f) => f.id).join(',')}])`).toBeUndefined()
    expect(
      createdPtIds.every((pid) => afterUndo.points[pid] === undefined),
      `the SAME undo also removes the seeded point — no orphan left behind (got points=[${Object.keys(afterUndo.points).join(',')}])`,
    ).toBe(true)

    // (iv) blank-canvas wire-drop composition (Canvas.tsx's resolveDropPoint):
    // addForm('empty') then addPoint(..., 'self') must end with EXACTLY one
    // point — addPoint's capacity reuse returns the seeded id, and (per the
    // store-level guard tested above) the identical diagram reference so no
    // extra history entry gets pushed for the second call.
    const [d3, formId3] = addForm(empty, 'empty', { x: 0, y: 0 })
    const seededId3 = (d3.forms.find((f) => f.id === formId3)!.edges.self ?? [])[0]
    const [d4, reusedId] = addPoint(d3, formId3, 'self')
    expect(reusedId, `addPoint on a freshly-seeded empty form REUSES the seeded id (got ${reusedId}, want ${seededId3})`).toBe(seededId3)
    expect(d4, `that reuse returns the IDENTICAL diagram reference — a true no-op, per the setCur identity guard`).toBe(d3)
    expect(
      (d4.forms.find((f) => f.id === formId3)!.edges.self ?? []).length,
      `still exactly one point after the composed addForm + addPoint (got [${(d4.forms.find((f) => f.id === formId3)!.edges.self ?? []).join(',')}])`,
    ).toBe(1)
  })

  // Canvas.tsx per-kind centering (createForm) — NOT independently tested
  // here. createForm is a client-component-local useCallback, not an exported
  // pure function, and Canvas.tsx itself can't be imported headless under the
  // Vitest node environment (it pulls in '@xyflow/react/dist/style.css' and
  // JSX/React, which the tsx loader used by the original bare-tsx script
  // rejected — confirmed: `npx tsx -e "import('./components/editor/Canvas.tsx')"`
  // throws `Unexpected token '.'` on the CSS import before any of createForm's
  // own logic runs). Extracting a standalone pure helper was out of scope for
  // this ticket's write set (Canvas.tsx's own math was kept small and read
  // literally: n = geometryFor(kind).nodeSize(freshForm), position = center -
  // n/2, then the EXISTING snapCenterPosition is reused unmodified for the
  // grid-on case — see the comments at createForm's definition). This
  // composition was instead verified live in the browser (rail-drag +
  // double-click for both 'empty' and a 200px kind) — see the task report,
  // not this file.

  it('INVARIANT: an empty form never exists without its middle point', () => {
    // Deleting the middle point deletes the FORM with it (cascade through
    // deleteForm, so its lines are pruned too); loading a pre-seeding save
    // whose empty form has NO point drops that form outright (no legacy
    // support — no seeding of old saves).

    // removePoint on the middle point → whole form (and its lines) gone.
    const [seeded, formId] = addForm(
      { schemaVersion: 1, forms: [bareForm('SQ', 'square', { edges: { top: ['PX'] } })], points: { PX: { id: 'PX', shape: 'empty', formId: 'SQ', edgeKey: 'top' } }, lines: [] },
      'empty', { x: 0, y: 0 },
    )
    const mid = seeded.forms.find((f) => f.id === formId)!.edges.self[0]
    const wired: Diagram = { ...seeded, lines: [{ id: 'LX', source: 'PX', targets: [mid] }] }
    const after = removePoint(wired, mid)
    expect(after.forms.find((f) => f.id === formId), `deleting the middle point deletes the empty form itself`).toBeUndefined()
    expect(after.points[mid], `the middle point is gone with it`).toBeUndefined()
    expect(after.lines.length, `the line into the middle point is pruned (got ${after.lines.length})`).toBe(0)
    expect(after.forms.find((f) => f.id === 'SQ') !== undefined && after.points.PX !== undefined, `the OTHER form and its point survive`).toBe(true)

    // Regression: removePoint on a normal form's point never deletes the form.
    const after2 = removePoint(wired, 'PX')
    expect(after2.forms.find((f) => f.id === 'SQ'), `removing a square's point keeps the square`).not.toBeUndefined()
    expect(after2.points.PX, `...while the point itself is removed`).toBeUndefined()

    // Load-time: a zero-point empty form (pre-seeding save) is dropped.
    const raw = {
      schemaVersion: 1,
      forms: [
        { id: 'BARE', kind: 'empty', position: { x: 0, y: 0 }, edges: {}, corners: {} },
        { id: 'SQ2', kind: 'square', position: { x: 300, y: 0 }, edges: {}, corners: {} },
      ],
      points: {}, lines: [],
    }
    const restored = restoreDiagram(raw)
    expect(restored.forms.find((f) => f.id === 'BARE'), `restore drops an empty form that has no middle point (no legacy seeding)`).toBeUndefined()
    expect(restored.forms.find((f) => f.id === 'SQ2'), `other forms pass through untouched`).not.toBeUndefined()
    expect(JSON.stringify(restoreDiagram(restored)), `the drop is idempotent on re-restore`).toBe(JSON.stringify(restored))
  })
})
