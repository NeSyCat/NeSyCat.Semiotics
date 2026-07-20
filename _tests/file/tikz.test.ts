// Standalone test script for the TikZ exporter — no Vitest wired yet (see
// _tests/README.md), so this runs directly under tsx:
//
//   npx tsx _tests/file/tikz.test.ts
//
// Plain assertions; prints one PASS/FAIL line per check and exits non-zero
// if anything failed.

import { snapCoord, snapPoint, snapCenterPosition, GRID_SIZE } from '../../components/editor2/grid'
import { diagramToTikzCore, diagramToTikz, formBodyVerticesPx, pointPositionsPx } from '../../components/editor2/tikz'
import type { Diagram, Form } from '../../components/editor2/types'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) {
    pass++
    console.log(`PASS: ${msg}`)
  } else {
    fail++
    console.log(`FAIL: ${msg}`)
  }
}
function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol
}

function emptyDiagram(): Diagram {
  return { schemaVersion: 1, forms: [], points: {}, lines: [] }
}

// A bare 200x200 square form (no points attached) — the default nodeSize.
function bareSquare(id: string, position: { x: number; y: number }, extra: Partial<Form> = {}): Form {
  return { id, kind: 'square', position, edges: {}, ...extra }
}

// ── grid.ts ──────────────────────────────────────────────────────────

assert(GRID_SIZE === 50, 'GRID_SIZE is 50')
assert(snapCoord(137) === 150, 'snapCoord(137) -> 150')
assert(snapCoord(212) === 200, 'snapCoord(212) -> 200')
{
  const snapped = snapPoint({ x: 137, y: 212 })
  assert(snapped.x === 150 && snapped.y === 200, 'snapPoint({137,212}) -> {150,200}')
}
{
  // A bare square (n=200) at raw position (137,212): center = (237, 312) ->
  // snaps to (250, 300) -> position = center - n/2 = (150, 200).
  const snapped = snapCenterPosition({ kind: 'square', scale: undefined, edges: {} }, { x: 137, y: 212 })
  assert(snapped.x === 150 && snapped.y === 200, 'snapCenterPosition (form-aware) matches raw snapPoint result for a bare 200px square')
}

// ── Test 1: a grid-snapped square exports 0.5-multiple cm coordinates ──
{
  const position = snapCenterPosition({ kind: 'square', scale: undefined, edges: {} }, { x: 683, y: -419 })
  const d = emptyDiagram()
  d.forms.push(bareSquare('SQ', position))
  const tikz = diagramToTikzCore(d)
  const coords = [...tikz.matchAll(/\(([-\d.]+),([-\d.]+)\)/g)]
  assert(coords.length > 0, 'grid-snapped square emits at least one coordinate pair')
  const allHalfMultiples = coords.every(([, xs, ys]) => {
    const x2 = Number(xs) * 2
    const y2 = Number(ys) * 2
    return approx(x2, Math.round(x2), 1e-6) && approx(y2, Math.round(y2), 1e-6)
  })
  assert(allHalfMultiples, 'every coordinate of a grid-snapped form is a multiple of 0.5cm')
}

// ── Test 2: y-flip — a form above another (smaller flow-Y) gets a LARGER
// TikZ y ──────────────────────────────────────────────────────────────
{
  const d = emptyDiagram()
  d.forms.push(bareSquare('FA', { x: 0, y: 0 })) // "above" on screen
  d.forms.push(bareSquare('FB', { x: 0, y: 500 })) // "below" on screen
  const tikz = diagramToTikzCore(d)
  const findNodeY = (label: string): number => {
    const line = tikz.split('\n').find((l) => l.includes(`{$${label}$}`))
    if (!line) throw new Error(`label node not found: ${label}\n${tikz}`)
    const m = line.match(/\(([-\d.]+),([-\d.]+)\)/)
    if (!m) throw new Error(`no coordinate in line: ${line}`)
    return Number(m[2])
  }
  const yA = findNodeY('FA')
  const yB = findNodeY('FB')
  assert(yA > yB, `y-flip: form above (flow y=0) has larger TikZ y than form below (flow y=500) — got yA=${yA}, yB=${yB}`)
}

// ── Test 3: a rotated square's vertices match a hand-computed rotation ──
// A square at position (0,0) (n=200, center=(100,100)) rotated 90° CW: since
// a square has 4-fold rotational symmetry, rotating it 90° must map its
// corner SET onto itself — hand-derived exactly (cos90=0, sin90=1, no FP
// error): (0,0)->(200,0), (200,0)->(200,200), (200,200)->(0,200),
// (0,200)->(0,0).
{
  const rotated = bareSquare('R1', { x: 0, y: 0 }, { rotation: 90 })
  const verts = formBodyVerticesPx(rotated)
  assert(verts !== null, 'formBodyVerticesPx returns a vertex list for a polygon body')
  const expected = [{ x: 200, y: 0 }, { x: 200, y: 200 }, { x: 0, y: 200 }, { x: 0, y: 0 }]
  const matches = verts !== null && verts.length === expected.length &&
    verts.every((v, i) => approx(v.x, expected[i].x, 1e-6) && approx(v.y, expected[i].y, 1e-6))
  assert(matches, `90°-rotated square vertices match hand computation — got ${JSON.stringify(verts)}`)
}

// ── Test 4: a line between two points connects the two COMPUTED point
// coordinates (via the exporter's own pointPositionsPx, the shared source
// of truth) — checked as a px->cm delta, so it doesn't need to replicate
// the exporter's own min/max normalization independently. ────────────────
{
  const d = emptyDiagram()
  const f1 = bareSquare('LF1', { x: 0, y: 0 }, { edges: { top: [], right: ['P1'], bottom: [], left: [] } })
  const f2 = bareSquare('LF2', { x: 300, y: 0 }, { edges: { top: [], right: [], bottom: [], left: ['P2'] } })
  d.forms.push(f1, f2)
  d.points['P1'] = { id: 'P1', shape: 'empty', formId: 'LF1', edgeKey: 'right' }
  d.points['P2'] = { id: 'P2', shape: 'empty', formId: 'LF2', edgeKey: 'left' }
  d.lines.push({ id: 'LN1', source: 'P1', targets: ['P2'] })

  const expected = pointPositionsPx(d)
  const p1 = expected.get('P1')!.pos
  const p2 = expected.get('P2')!.pos

  const tikz = diagramToTikzCore(d)
  // Distinguish the CONNECTING line from the two forms' own border draws —
  // both happen to use the same 0.4pt stroke width, but only a form border
  // is a closed `draw=...` polygon path ending in `-- cycle`.
  const drawLine = tikz.split('\n').find((l) => l.trim().startsWith('\\draw[') && !l.includes('cycle') && !l.includes('draw='))
  assert(!!drawLine, 'a \\draw command for the line is emitted')
  const m = drawLine?.match(/\(([-\d.]+),([-\d.]+)\) -- \(([-\d.]+),([-\d.]+)\)/)
  assert(!!m, 'the line draw command has two coordinate pairs')
  if (m) {
    const [, x1, y1, x2, y2] = m.map(Number) as unknown as number[]
    const dxCm = x2 - x1
    const dyCm = y2 - y1
    const expectedDxCm = (p2.x - p1.x) / 100
    const expectedDyCm = -(p2.y - p1.y) / 100 // y-flip
    assert(approx(dxCm, expectedDxCm, 1e-6), `line dx matches computed point coords — got ${dxCm}, expected ${expectedDxCm}`)
    assert(approx(dyCm, expectedDyCm, 1e-6), `line dy matches computed point coords (y-flipped) — got ${dyCm}, expected ${expectedDyCm}`)
  }
}

// ── Test 5: color emission — \definecolor with the right rgb ──────────
{
  const d = emptyDiagram()
  d.forms.push(bareSquare('CF1', { x: 0, y: 0 }, { color: [1, 0, 0.5] }))
  const tikz = diagramToTikzCore(d)
  assert(/\\definecolor\{nesyColor0\}\{rgb\}\{1,0,0\.5\}/.test(tikz), 'form color [1,0,0.5] emits \\definecolor{...}{rgb}{1,0,0.5}')
  assert(/\\filldraw\[fill=nesyColor0,/.test(tikz), 'the colored form fills with the registered color name')
}

// ── Test 6: structural sanity — balanced begin/end, no NaN/undefined ──
{
  const d = emptyDiagram()
  const f1 = bareSquare('KF1', { x: -137, y: 88 }, { rotation: 37, scale: 1.4, color: [0.2, 0.6, 0.9], edges: { top: [], right: ['KP1'], bottom: [], left: [] } })
  const f2 = bareSquare('KF2', { x: 400, y: -220 }, { edges: { top: [], right: [], bottom: [], left: ['KP2'] } })
  d.forms.push(f1, f2)
  d.points['KP1'] = { id: 'KP1', shape: 'circle', name: 'x', formId: 'KF1', edgeKey: 'right', color: [1, 0, 0] }
  d.points['KP2'] = { id: 'KP2', shape: 'triangle', formId: 'KF2', edgeKey: 'left' }
  d.lines.push({ id: 'KL1', name: 'f', source: 'KP1', targets: ['KP2'], color: [0, 0, 1] })
  const tikz = diagramToTikzCore(d, 'd=1.deadbeef')

  const beginCount = (tikz.match(/\\begin\{tikzpicture\}/g) ?? []).length
  const endCount = (tikz.match(/\\end\{tikzpicture\}/g) ?? []).length
  assert(beginCount === 1 && endCount === 1, `exactly one balanced begin/end tikzpicture pair (begin=${beginCount}, end=${endCount})`)
  assert(!/NaN/.test(tikz), 'no NaN in output')
  assert(!/undefined/.test(tikz), 'no undefined in output')
  assert(tikz.includes('% Exported from NeSyCat Semiotics'), 'header comment present')
  assert(tikz.includes('% https://semiotics.nesycat.org/editor#d=1.deadbeef'), 'quiver-style re-import link present')
}

// ── Test 7: the async wrapper resolves (share.ts's fragment encoder is
// browser-oriented but works under modern node too) ────────────────────
async function testAsync() {
  const d = emptyDiagram()
  d.forms.push(bareSquare('AF1', { x: 0, y: 0 }))
  try {
    const tikz = await diagramToTikz(d)
    assert(tikz.includes('\\begin{tikzpicture}') && tikz.includes('% https://semiotics.nesycat.org/editor#'), 'async diagramToTikz resolves with a header + re-import link')
  } catch (err) {
    assert(false, `async diagramToTikz should not throw — ${err}`)
  }
}

testAsync().then(() => {
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
})
