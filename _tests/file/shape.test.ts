// Standalone test script for the unified Shape type (types.ts) — FormKind and
// PointShape collapsed into ONE 5-member vocabulary shared by Form.kind and
// Point.shape. No Vitest wired yet (see _tests/README.md), so this runs
// directly under tsx:
//
//   npx tsx _tests/file/shape.test.ts
//
// Plain assertions; prints one PASS/FAIL line per check and exits non-zero
// if anything failed.

import { formRegistry, SHAPES } from '../../components/editor2/forms'
import { restoreDiagram } from '../../components/editor2/io'
import { addForm, addPoint, setPointShape } from '../../components/editor2/mutations'
import type { Diagram, Shape } from '../../components/editor2/types'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`PASS: ${msg}`) } else { fail++; console.log(`FAIL: ${msg}`) }
}

const VALID_SHAPES: Shape[] = ['empty', 'triangle', 'square', 'circle', 'rhombus']

// ── (iii) the valid-shape set has EXACTLY the 5 members ──────────────────
{
  assert(SHAPES.length === 5, `forms.ts's SHAPES has exactly 5 members (got ${SHAPES.length}: [${SHAPES.join(',')}])`)
  assert(
    [...SHAPES].sort().join(',') === [...VALID_SHAPES].sort().join(','),
    `SHAPES is exactly {empty,triangle,square,circle,rhombus} (got [${[...SHAPES].sort().join(',')}])`,
  )
  assert(
    Object.keys(formRegistry).sort().join(',') === [...VALID_SHAPES].sort().join(','),
    `formRegistry's own keys agree with SHAPES (got [${Object.keys(formRegistry).sort().join(',')}])`,
  )
}

// ── (i) restoreDiagram maps every legacy/unknown point shape to 'empty',
// and passes the 5 valid shapes through unchanged ────────────────────────
{
  const LEGACY = ['point', 'line', 'pentagon', 'hexagon', 'dot', null, undefined, 'nonsense']
  for (const legacy of LEGACY) {
    const raw = {
      schemaVersion: 1,
      forms: [{ id: 'F', kind: 'square', position: { x: 0, y: 0 }, edges: { top: ['P'] } }],
      points: { P: { id: 'P', shape: legacy, formId: 'F', edgeKey: 'top' } },
      lines: [],
    }
    const d = restoreDiagram(raw)
    assert(d.points.P?.shape === 'empty', `legacy point shape ${JSON.stringify(legacy)} normalizes to 'empty' (got ${d.points.P?.shape})`)
  }

  for (const valid of VALID_SHAPES) {
    const raw = {
      schemaVersion: 1,
      forms: [{ id: 'F', kind: 'square', position: { x: 0, y: 0 }, edges: { top: ['P'] } }],
      points: { P: { id: 'P', shape: valid, formId: 'F', edgeKey: 'top' } },
      lines: [],
    }
    const d = restoreDiagram(raw)
    assert(d.points.P?.shape === valid, `valid point shape '${valid}' passes through restoreDiagram unchanged (got ${d.points.P?.shape})`)
  }
}

// ── (ii) a point with a valid shape survives a full round-trip ───────────
{
  const original: Diagram = {
    schemaVersion: 1,
    forms: [{ id: 'RT', kind: 'circle', position: { x: 0, y: 0 }, edges: { up: ['RP'], right: [], down: [], left: [] } }],
    points: { RP: { id: 'RP', shape: 'triangle', formId: 'RT', edgeKey: 'up' } },
    lines: [],
  }
  const restored = restoreDiagram(original)
  assert(restored.points.RP?.shape === 'triangle', `a point's valid shape ('triangle') round-trips through restoreDiagram unchanged`)
  assert(JSON.stringify(restored) === JSON.stringify(original), `the whole diagram round-trips byte-for-byte unchanged`)
}

// ── (iv) a form of each of the 5 kinds constructs, and its point can take
// each of the 5 shapes. 'empty' seeds its own (capacity-1) point via
// addForm — setPointShape (not another addPoint, which would just REUSE
// that single point per forms.ts's maxPoints capacity) cycles it through
// every shape; the other kinds get a fresh point via addPoint. ───────────
{
  const empty: Diagram = { schemaVersion: 1, forms: [], points: {}, lines: [] }
  for (const kind of VALID_SHAPES) {
    const [d, formId] = addForm(empty, kind, { x: 0, y: 0 })
    const form = d.forms.find((f) => f.id === formId)
    assert(form !== undefined && form.kind === kind, `addForm constructs a '${kind}' form`)
    const edgeKey = formRegistry[kind].edgeKeys[0]
    const seededId = (form?.edges[edgeKey] ?? [])[0]
    const [d1, pointId] = seededId !== undefined ? [d, seededId] : addPoint(d, formId, edgeKey)
    for (const pshape of VALID_SHAPES) {
      const d2 = setPointShape(d1, pointId, pshape)
      const pt = d2.points[pointId]
      assert(pt !== undefined && pt.shape === pshape, `a point on a '${kind}' form can take shape '${pshape}' (got ${pt?.shape})`)
    }
  }
}

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)
