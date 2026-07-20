// Test suite for the unified Shape type (types.ts) — FormShape and
// PointShape collapsed into ONE 5-member vocabulary shared by Form.shape and
// Point.shape. Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { formRegistry, SHAPES } from '../../components/editor/domain/forms'
import { restoreDiagram } from '../../components/editor/persist/io'
import { addForm, addPoint, setPointShape } from '../../components/editor/domain/mutations'
import type { Diagram, Shape } from '../../components/editor/domain/types'

const VALID_SHAPES: Shape[] = ['empty', 'triangle', 'square', 'circle', 'rhombus']

describe('unified Shape vocabulary', () => {
  it('the valid-shape set has EXACTLY the 5 members', () => {
    expect(SHAPES.length, `forms.ts's SHAPES has exactly 5 members (got ${SHAPES.length}: [${SHAPES.join(',')}])`).toBe(5)
    expect(
      [...SHAPES].sort().join(','),
      `SHAPES is exactly {empty,triangle,square,circle,rhombus} (got [${[...SHAPES].sort().join(',')}])`,
    ).toBe([...VALID_SHAPES].sort().join(','))
    expect(
      Object.keys(formRegistry).sort().join(','),
      `formRegistry's own keys agree with SHAPES (got [${Object.keys(formRegistry).sort().join(',')}])`,
    ).toBe([...VALID_SHAPES].sort().join(','))
  })

  it("restoreDiagram maps every legacy/unknown point shape to 'empty', and passes the 5 valid shapes through unchanged", () => {
    const LEGACY = ['point', 'line', 'pentagon', 'hexagon', 'dot', null, undefined, 'nonsense']
    for (const legacy of LEGACY) {
      const raw = {
        schemaVersion: 1,
        forms: [{ id: 'F', shape: 'square', position: { x: 0, y: 0 }, edges: { top: ['P'] } }],
        points: { P: { id: 'P', shape: legacy, formId: 'F', edgeKey: 'top' } },
        lines: [],
      }
      const d = restoreDiagram(raw)
      expect(d.points.P?.shape, `legacy point shape ${JSON.stringify(legacy)} normalizes to 'empty' (got ${d.points.P?.shape})`).toBe('empty')
    }

    for (const valid of VALID_SHAPES) {
      const raw = {
        schemaVersion: 1,
        forms: [{ id: 'F', shape: 'square', position: { x: 0, y: 0 }, edges: { top: ['P'] } }],
        points: { P: { id: 'P', shape: valid, formId: 'F', edgeKey: 'top' } },
        lines: [],
      }
      const d = restoreDiagram(raw)
      expect(d.points.P?.shape, `valid point shape '${valid}' passes through restoreDiagram unchanged (got ${d.points.P?.shape})`).toBe(valid)
    }
  })

  it('a point with a valid shape survives a full round-trip', () => {
    const original: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'RT', shape: 'circle', position: { x: 0, y: 0 }, edges: { up: ['RP'], right: [], down: [], left: [] } }],
      points: { RP: { id: 'RP', shape: 'triangle', formId: 'RT', edgeKey: 'up' } },
      lines: [],
    }
    const restored = restoreDiagram(original)
    expect(restored.points.RP?.shape, `a point's valid shape ('triangle') round-trips through restoreDiagram unchanged`).toBe('triangle')
    expect(JSON.stringify(restored), `the whole diagram round-trips byte-for-byte unchanged`).toBe(JSON.stringify(original))
  })

  it("a form of each of the 5 shapes constructs, and its point can take each of the 5 shapes", () => {
    // 'empty' seeds its own (capacity-1) point via addForm — setPointShape
    // (not another addPoint, which would just REUSE that single point per
    // forms.ts's maxPoints capacity) cycles it through every shape; the
    // other shapes get a fresh point via addPoint.
    const empty: Diagram = { schemaVersion: 1, forms: [], points: {}, lines: [] }
    for (const shape of VALID_SHAPES) {
      const [d, formId] = addForm(empty, shape, { x: 0, y: 0 })
      const form = d.forms.find((f) => f.id === formId)
      expect(form !== undefined && form.shape === shape, `addForm constructs a '${shape}' form`).toBe(true)
      const edgeKey = formRegistry[shape].edgeKeys[0]
      const seededId = (form?.edges[edgeKey] ?? [])[0]
      const [d1, pointId] = seededId !== undefined ? [d, seededId] : addPoint(d, formId, edgeKey)
      for (const pshape of VALID_SHAPES) {
        const d2 = setPointShape(d1, pointId, pshape)
        const pt = d2.points[pointId]
        expect(pt !== undefined && pt.shape === pshape, `a point on a '${shape}' form can take shape '${pshape}' (got ${pt?.shape})`).toBe(true)
      }
    }
  })
})
