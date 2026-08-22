import { describe, it, expect } from 'vitest'
import { emptyDiagram } from '../src/diagram/defaults.js'
import { addFormOp, addPointOp, addLineOp, removeElementOp, setElementNameOp, moveFormOp } from '../src/diagram/ops.js'
import { restoreDiagram } from '../../components/editor/persist/io.js'

describe('drawing ops (pure core)', () => {
  it('add form -> add points on valid edges -> add line produces a diagram that passes restoreDiagram', () => {
    let d = emptyDiagram()

    const form = addFormOp(d, { shape: 'square', position: { x: 10, y: 20 }, name: 'Box' })
    expect(form.ok).toBe(true)
    if (!form.ok) return
    d = form.diagram
    const formId = form.id!
    expect(d.forms).toHaveLength(1)
    expect(d.forms[0].name).toBe('Box')

    const p1 = addPointOp(d, { formId, edgeKey: 'top', name: 'in' })
    expect(p1.ok).toBe(true)
    if (!p1.ok) return
    d = p1.diagram
    const p1Id = p1.id!

    const p2 = addPointOp(d, { formId, edgeKey: 'bottom' })
    expect(p2.ok).toBe(true)
    if (!p2.ok) return
    d = p2.diagram
    const p2Id = p2.id!

    expect(Object.keys(d.points)).toHaveLength(2)
    expect(d.forms[0].edges.top).toEqual([p1Id])
    expect(d.forms[0].edges.bottom).toEqual([p2Id])

    const line = addLineOp(d, { sourcePointId: p1Id, targetPointIds: [p2Id], name: 'wire' })
    expect(line.ok).toBe(true)
    if (!line.ok) return
    d = line.diagram
    expect(d.lines).toHaveLength(1)
    expect(d.lines[0]).toMatchObject({ source: p1Id, targets: [p2Id], name: 'wire' })

    // The whole thing must survive restoreDiagram unchanged (no dangling
    // refs, no dropped forms/points/lines) — restoreDiagram is idempotent
    // on an already-valid diagram.
    const restored = restoreDiagram(d)
    expect(restored.forms).toHaveLength(1)
    expect(Object.keys(restored.points)).toHaveLength(2)
    expect(restored.lines).toHaveLength(1)
  })

  it('add_point rejects an edge key invalid for the shape', () => {
    let d = emptyDiagram()
    const form = addFormOp(d, { shape: 'square', position: { x: 0, y: 0 } })
    expect(form.ok).toBe(true)
    if (!form.ok) return
    d = form.diagram

    const bad = addPointOp(d, { formId: form.id!, edgeKey: 'peak' }) // 'peak' is a triangle-only edge key
    expect(bad.ok).toBe(false)
    if (bad.ok) return
    expect(bad.error).toMatch(/not a valid edge key/i)
    expect(bad.error).toMatch(/top/) // lists the valid keys for square

    // Diagram is untouched by a rejected op — no partial point.
    expect(Object.keys(d.points)).toHaveLength(0)
  })

  it('add_point rejects an unknown formId', () => {
    const d = emptyDiagram()
    const result = addPointOp(d, { formId: 'F999', edgeKey: 'top' })
    expect(result.ok).toBe(false)
  })

  it('add_line rejects an unknown source or target point id', () => {
    const d = emptyDiagram()
    expect(addLineOp(d, { sourcePointId: 'P1', targetPointIds: ['P2'] }).ok).toBe(false)
  })

  it('remove_element removing a form also removes its points and touching lines', () => {
    let d = emptyDiagram()
    const form = addFormOp(d, { shape: 'square', position: { x: 0, y: 0 } })
    if (!form.ok) throw new Error('setup failed')
    d = form.diagram
    const p1 = addPointOp(d, { formId: form.id!, edgeKey: 'top' })
    if (!p1.ok) throw new Error('setup failed')
    d = p1.diagram
    const p2 = addPointOp(d, { formId: form.id!, edgeKey: 'bottom' })
    if (!p2.ok) throw new Error('setup failed')
    d = p2.diagram
    const line = addLineOp(d, { sourcePointId: p1.id!, targetPointIds: [p2.id!] })
    if (!line.ok) throw new Error('setup failed')
    d = line.diagram

    const removed = removeElementOp(d, 'form', form.id!)
    expect(removed.ok).toBe(true)
    if (!removed.ok) return
    expect(removed.diagram.forms).toHaveLength(0)
    expect(Object.keys(removed.diagram.points)).toHaveLength(0)
    expect(removed.diagram.lines).toHaveLength(0)
  })

  it('remove_element on a missing id is a reported error, not a silent no-op', () => {
    const d = emptyDiagram()
    expect(removeElementOp(d, 'form', 'F999').ok).toBe(false)
    expect(removeElementOp(d, 'point', 'P999').ok).toBe(false)
    expect(removeElementOp(d, 'line', 'L999').ok).toBe(false)
  })

  it('set_element_name renames a form/point/line', () => {
    let d = emptyDiagram()
    const form = addFormOp(d, { shape: 'circle', position: { x: 0, y: 0 } })
    if (!form.ok) throw new Error('setup failed')
    d = form.diagram
    const renamed = setElementNameOp(d, 'form', form.id!, 'Renamed')
    expect(renamed.ok).toBe(true)
    if (!renamed.ok) return
    expect(renamed.diagram.forms[0].name).toBe('Renamed')
  })

  it('move_form updates position', () => {
    let d = emptyDiagram()
    const form = addFormOp(d, { shape: 'rhombus', position: { x: 0, y: 0 } })
    if (!form.ok) throw new Error('setup failed')
    d = form.diagram
    const moved = moveFormOp(d, form.id!, { x: 42, y: 7 })
    expect(moved.ok).toBe(true)
    if (!moved.ok) return
    expect(moved.diagram.forms[0].position).toEqual({ x: 42, y: 7 })
  })

  it("addFormOp rejects an unknown shape", () => {
    const d = emptyDiagram()
    // @ts-expect-error deliberately invalid shape to exercise the runtime guard
    const result = addFormOp(d, { shape: 'hexagon', position: { x: 0, y: 0 } })
    expect(result.ok).toBe(false)
  })
})
