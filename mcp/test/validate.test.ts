import { describe, it, expect } from 'vitest'
import { validateDiagram } from '../src/diagram/ops.js'
import { emptyDiagram } from '../src/diagram/defaults.js'
import { addFormOp, addPointOp, addLineOp } from '../src/diagram/ops.js'

describe('validate_diagram', () => {
  it('reports ok:true with no problems for a valid diagram', () => {
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

    const result = validateDiagram(line.diagram)
    expect(result.ok).toBe(true)
    expect(result.problems).toEqual([])
  })

  it('flags a line that references a missing point', () => {
    const raw = {
      schemaVersion: 1,
      forms: [],
      points: {},
      lines: [{ id: 'L1', source: 'P404', targets: ['P405'] }],
    }
    const result = validateDiagram(raw)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('L1') && p.includes('P404'))).toBe(true)
    expect(result.problems.some((p) => p.includes('L1') && p.includes('P405'))).toBe(true)
  })

  it('flags a point that references a missing form', () => {
    const raw = {
      schemaVersion: 1,
      forms: [],
      points: { P1: { id: 'P1', shape: 'empty', formId: 'F404', edgeKey: 'self' } },
      lines: [],
    }
    const result = validateDiagram(raw)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('P1') && p.includes('F404'))).toBe(true)
  })

  it('flags a form edge that references a missing point', () => {
    const raw = {
      schemaVersion: 1,
      forms: [
        {
          id: 'F1',
          shape: 'square',
          position: { x: 0, y: 0 },
          edges: { top: ['P404'], right: [], bottom: [], left: [] },
        },
      ],
      points: {},
      lines: [],
    }
    const result = validateDiagram(raw)
    expect(result.ok).toBe(false)
    expect(result.problems.some((p) => p.includes('F1') && p.includes('top') && p.includes('P404'))).toBe(true)
  })
})
