// Standalone test script for the simplified 'empty' FormKind — capacity
// reuse (mutations.ts's addPoint), the constant-center anchor (forms.ts's
// emptyGeometry), and the old-diagram collapse (io.ts's restoreDiagram) —
// plus a regression guard that 'point's own radial fan is untouched. No
// Vitest wired yet (see _tests/README.md), so this runs directly under tsx:
//
//   npx tsx _tests/file/empty-form.test.ts

import { geometryFor } from '../../components/editor2/forms'
import { addPoint, addForm } from '../../components/editor2/mutations'
import { useStore, initStore } from '../../components/editor2/store'
import { restoreDiagram } from '../../components/editor2/io'
import type { Diagram, Form } from '../../components/editor2/types'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`PASS: ${msg}`) } else { fail++; console.log(`FAIL: ${msg}`) }
}

function bareForm(id: string, kind: Form['kind'], extra: Partial<Form> = {}): Form {
  return { id, kind, position: { x: 0, y: 0 }, edges: {}, corners: {}, ...extra }
}

// ── mutations.addPoint — capacity reuse (many drops, one point) ──────────
{
  const d: Diagram = { schemaVersion: 1, forms: [bareForm('E1', 'empty')], points: {}, lines: [] }

  const [d1, id1] = addPoint(d, 'E1', 'self')
  assert(id1 !== '', `first addPoint on an empty form creates a point (got id=${JSON.stringify(id1)})`)
  const list1 = d1.forms.find((f) => f.id === 'E1')!.edges.self
  assert(list1.length === 1 && list1[0] === id1, `empty form holds exactly the one middle point after the first drop (got [${list1.join(',')}])`)

  const [d2, id2] = addPoint(d1, 'E1', 'self')
  assert(id2 === id1, `a SECOND addPoint on the same empty form REUSES the existing middle point (got id2=${id2}, id1=${id1})`)
  const list2 = d2.forms.find((f) => f.id === 'E1')!.edges.self
  assert(list2.length === 1 && list2[0] === id1, `still exactly one point after the second drop (got [${list2.join(',')}])`)

  const [d3, id3] = addPoint(d2, 'E1', 'self')
  assert(id3 === id1, `a THIRD addPoint still reuses the same point — many lines, one point (got id3=${id3})`)
  assert(d3.forms.find((f) => f.id === 'E1')!.edges.self.length === 1, `still exactly one point after a third drop`)
}

// ── forms.ts's emptyGeometry — constant center anchor, any index/count ───
{
  const geom = geometryFor('empty')
  const n = 100
  const a0 = geom.pointAnchor('self', 0, 1, n)
  assert(a0.x === n / 2 && a0.y === n / 2, `empty's middle point sits dead-center for (index=0, count=1) (got x=${a0.x}, y=${a0.y})`)
  // Even for an out-of-model count/index (e.g. mid-load, before io.ts's own
  // collapse normalization runs) the anchor never fans — always the center.
  const a1 = geom.pointAnchor('self', 2, 5, n)
  assert(a1.x === n / 2 && a1.y === n / 2, `empty's anchor stays centered even for (index=2, count=5) (got x=${a1.x}, y=${a1.y})`)
  assert(geom.maxPoints === 1, `empty declares maxPoints=1`)
  assert(geom.nodeSize(bareForm('E', 'empty', { edges: { self: ['P1'] } })) === geom.nodeSize(bareForm('E', 'empty')), `empty's nodeSize never grows with point count`)
}

// ── io.ts's restoreDiagram — collapses an old fanned empty form to 1 point ─
{
  const raw = {
    schemaVersion: 1,
    forms: [
      { id: 'A', kind: 'square', position: { x: 0, y: 0 }, edges: { top: ['PA'] }, corners: {} },
      { id: 'E', kind: 'empty', position: { x: 200, y: 0 }, edges: { self: ['P1', 'P2'] }, corners: {} },
    ],
    points: {
      PA: { id: 'PA', shape: 'point', formId: 'A', edgeKey: 'top' },
      P1: { id: 'P1', shape: 'point', formId: 'E', edgeKey: 'self' },
      P2: { id: 'P2', shape: 'point', formId: 'E', edgeKey: 'self' },
    },
    lines: [
      { id: 'L1', source: 'PA', targets: ['P1'] },
      { id: 'L2', source: 'PA', targets: ['P2'] },
    ],
  }
  const d = restoreDiagram(raw)
  const eForm = d.forms.find((f) => f.id === 'E')!
  assert(eForm.edges.self.length === 1, `restoreDiagram collapses the empty form's 2 points to 1 (got [${eForm.edges.self.join(',')}])`)
  const kept = eForm.edges.self[0]
  assert(kept === 'P1', `keeps the FIRST point id (got ${kept})`)
  assert(d.points.P2 === undefined, `the dropped point (P2) is deleted — no dangling reference`)
  assert(Object.keys(d.points).length === 2, `only the kept point + the untouched one remain (got [${Object.keys(d.points).join(',')}])`)
  const l1 = d.lines.find((l) => l.id === 'L1')!
  const l2 = d.lines.find((l) => l.id === 'L2')!
  assert(l1.targets[0] === kept, `L1 (already pointing at the kept id) is unchanged (got ${l1.targets[0]})`)
  assert(l2.targets[0] === kept, `L2 (pointed at the dropped id) is re-pointed to the kept id (got ${l2.targets[0]})`)
  assert(d.lines.length === 2, `no line was lost — both still meet in the middle (got ${d.lines.length})`)

  // Idempotent: collapsing an already-collapsed diagram is a no-op.
  const d2 = restoreDiagram(d)
  assert(JSON.stringify(d2) === JSON.stringify(d), `re-running restoreDiagram on its own output is a no-op (idempotent)`)
}

// ── io.ts — degenerate-line handling: a line collapsing onto its own source
// (both ends land on the SAME kept middle point) is dropped, not kept as a
// self-loop ────────────────────────────────────────────────────────────────
{
  const raw = {
    schemaVersion: 1,
    forms: [{ id: 'E2', kind: 'empty', position: { x: 0, y: 0 }, edges: { self: ['Q1', 'Q2'] }, corners: {} }],
    points: {
      Q1: { id: 'Q1', shape: 'point', formId: 'E2', edgeKey: 'self' },
      Q2: { id: 'Q2', shape: 'point', formId: 'E2', edgeKey: 'self' },
    },
    lines: [{ id: 'L3', source: 'Q1', targets: ['Q2'] }], // both ends on the same (soon-to-collapse) form
  }
  const d = restoreDiagram(raw)
  assert(d.forms.find((f) => f.id === 'E2')!.edges.self.length === 1, `the empty form still collapses to 1 point even though its only line disappears`)
  assert(d.lines.find((l) => l.id === 'L3') === undefined, `a line whose source and only target collapse onto the SAME kept point is dropped (degenerate self-loop)`)
  assert(d.points.Q1 !== undefined && d.points.Q2 === undefined, `Q1 (kept) survives, Q2 (dropped) doesn't`)
}

// ── REGRESSION GUARD: 'point' kind's unbounded radial fan is untouched ───
{
  const geom = geometryFor('point')
  assert(geom.maxPoints === undefined, `'point' kind has no capacity cap (unbounded fan, unlike 'empty')`)
  const n = 100
  const a = geom.pointAnchor('self', 1, 4, n) // index=1 of 4 -> theta = (1/4)*2pi = pi/2 ("up")
  const expectedX = n / 2 + (n / 2) * Math.cos(Math.PI / 2)
  const expectedY = n / 2 - (n / 2) * Math.sin(Math.PI / 2)
  assert(
    Math.abs(a.x - expectedX) < 1e-9 && Math.abs(a.y - expectedY) < 1e-9,
    `'point' kind's radial fan formula is unchanged by the 'empty' simplification (got x=${a.x}, y=${a.y}, want x=${expectedX}, y=${expectedY})`,
  )
  // A 'point' form with several points genuinely still reuses NOTHING — a
  // fresh addPoint always creates a new one (no maxPoints reuse for 'point').
  const d: Diagram = { schemaVersion: 1, forms: [bareForm('PT1', 'point')], points: {}, lines: [] }
  const [d1, id1] = addPoint(d, 'PT1', 'self')
  const [d2, id2] = addPoint(d1, 'PT1', 'self')
  assert(id1 !== id2, `'point' kind's addPoint creates a NEW point every time, no capacity reuse (got id1=${id1}, id2=${id2})`)
  assert(d2.forms.find((f) => f.id === 'PT1')!.edges.self.length === 2, `'point' form correctly fans to 2 points (got ${d2.forms.find((f) => f.id === 'PT1')!.edges.self.length})`)
}

// ── STORE: capacity reuse must not push a phantom undo step ──────────────
// addPoint's reuse on a full 'empty' form returns the SAME diagram object;
// setCur's identity guard must skip history so the next undo isn't a
// visual no-op. Exercised through the real zustand store (works headless).
{
  const d: Diagram = { schemaVersion: 1, forms: [bareForm('SE1', 'empty')], points: {}, lines: [] }
  initStore(d)
  const first = useStore.getState().addPoint('SE1', 'self')
  const afterFirst = useStore.getState().historyIndex
  const second = useStore.getState().addPoint('SE1', 'self')
  assert(second === first, `store addPoint reuse returns the existing id (got ${second}, want ${first})`)
  assert(
    useStore.getState().historyIndex === afterFirst,
    `capacity reuse pushes NO history entry (historyIndex stayed ${afterFirst}, got ${useStore.getState().historyIndex})`,
  )
  useStore.getState().undo()
  assert(
    (useStore.getState().diagram.forms.find((f) => f.id === 'SE1')!.edges.self ?? []).length === 0,
    'one undo after two drops removes the point (no phantom no-op step in between)',
  )
}

// ── mutations.addForm — seeds the middle point for capacity-bearing kinds ─
// (the ticket's "when I drag an empty form onto the canvas it should
// already have a name point" request), in ONE returned Diagram — one undo
// step covers form + point together.
{
  const empty: Diagram = { schemaVersion: 1, forms: [], points: {}, lines: [] }

  // (i) addForm('empty') seeds exactly one point on 'self', shape 'empty'.
  const [d1, formId1] = addForm(empty, 'empty', { x: 0, y: 0 })
  const form1 = d1.forms.find((f) => f.id === formId1)!
  const seededIds = form1.edges.self ?? []
  assert(seededIds.length === 1, `addForm('empty') seeds exactly one point id on 'self' (got [${seededIds.join(',')}])`)
  const seededPoint = d1.points[seededIds[0]]
  assert(seededPoint !== undefined, `the seeded point id actually exists in points{} (got ${seededIds[0]})`)
  assert(seededPoint?.shape === 'empty', `the seeded point uses addPoint's default shape 'empty' (got ${seededPoint?.shape})`)
  assert(seededPoint?.formId === formId1 && seededPoint?.edgeKey === 'self', `the seeded point is attached to the new form's 'self' edge (got formId=${seededPoint?.formId}, edgeKey=${seededPoint?.edgeKey})`)

  // (ii) addForm for a kind with no maxPoints (e.g. 'square') seeds nothing.
  const [d2, formId2] = addForm(empty, 'square', { x: 0, y: 0 })
  const form2 = d2.forms.find((f) => f.id === formId2)!
  const squareEdgeCounts = Object.values(form2.edges).map((l) => l.length)
  assert(squareEdgeCounts.every((n) => n === 0), `addForm('square') seeds NO points on any side (got edges=${JSON.stringify(form2.edges)})`)
  assert(Object.keys(d2.points).length === 0, `'square' creation adds no entries to points{} (got ${Object.keys(d2.points).length})`)

  // (iii) store-level: create → historyIndex advances by exactly ONE; one
  // undo removes form AND point together.
  initStore(empty)
  const beforeIndex = useStore.getState().historyIndex
  const createdId = useStore.getState().addForm('empty', { x: 0, y: 0 })
  const afterIndex = useStore.getState().historyIndex
  assert(afterIndex === beforeIndex + 1, `store.addForm('empty') advances historyIndex by exactly ONE (was ${beforeIndex}, now ${afterIndex})`)
  const createdForm = useStore.getState().diagram.forms.find((f) => f.id === createdId)!
  const createdPtIds = createdForm.edges.self ?? []
  assert(createdPtIds.length === 1 && useStore.getState().diagram.points[createdPtIds[0]] !== undefined, `store.addForm('empty') diagram already has the form's middle point (got [${createdPtIds.join(',')}])`)
  useStore.getState().undo()
  const afterUndo = useStore.getState().diagram
  assert(afterUndo.forms.find((f) => f.id === createdId) === undefined, `one undo removes the seeded form (got forms=[${afterUndo.forms.map((f) => f.id).join(',')}])`)
  assert(createdPtIds.every((pid) => afterUndo.points[pid] === undefined), `the SAME undo also removes the seeded point — no orphan left behind (got points=[${Object.keys(afterUndo.points).join(',')}])`)

  // (iv) blank-canvas wire-drop composition (Canvas.tsx's resolveDropPoint):
  // addForm('empty') then addPoint(..., 'self') must end with EXACTLY one
  // point — addPoint's capacity reuse returns the seeded id, and (per the
  // store-level guard tested above) the identical diagram reference so no
  // extra history entry gets pushed for the second call.
  const [d3, formId3] = addForm(empty, 'empty', { x: 0, y: 0 })
  const seededId3 = (d3.forms.find((f) => f.id === formId3)!.edges.self ?? [])[0]
  const [d4, reusedId] = addPoint(d3, formId3, 'self')
  assert(reusedId === seededId3, `addPoint on a freshly-seeded empty form REUSES the seeded id (got ${reusedId}, want ${seededId3})`)
  assert(d4 === d3, `that reuse returns the IDENTICAL diagram reference — a true no-op, per the setCur identity guard`)
  assert((d4.forms.find((f) => f.id === formId3)!.edges.self ?? []).length === 1, `still exactly one point after the composed addForm + addPoint (got [${(d4.forms.find((f) => f.id === formId3)!.edges.self ?? []).join(',')}])`)
}

// ── Canvas.tsx per-kind centering (createForm) — NOT independently tested
// here. createForm is a client-component-local useCallback, not an exported
// pure function, and Canvas.tsx itself can't be imported headless under tsx
// (it pulls in '@xyflow/react/dist/style.css' and JSX/React, which the tsx
// loader used by this script rejects — confirmed: `npx tsx -e
// "import('./components/editor2/Canvas.tsx')"` throws `Unexpected token '.'`
// on the CSS import before any of createForm's own logic runs). Extracting
// a standalone pure helper was out of scope for this ticket's write set
// (Canvas.tsx's own math was kept small and read literally: n =
// geometryFor(kind).nodeSize(freshForm), position = center - n/2, then the
// EXISTING snapCenterPosition is reused unmodified for the grid-on case —
// see the comments at createForm's definition). This composition was
// instead verified live in the browser (rail-drag + double-click for both
// 'empty' and a 200px kind) — see the task report, not this file.

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
