import { describe, it, expect } from 'vitest'
import { duplicateData, duplicateTitle, addFormOp } from '../src/diagram/ops.js'
import { emptyDiagram } from '../src/diagram/defaults.js'

describe('duplicate_diagram (pure core)', () => {
  it('duplicateData deep-copies — same structure, no shared object identity', () => {
    let d = emptyDiagram()
    const form = addFormOp(d, { shape: 'triangle', position: { x: 1, y: 2 }, name: 'Original' })
    if (!form.ok) throw new Error('setup failed')
    d = form.diagram

    const copy = duplicateData(d)
    expect(copy).toEqual(d)
    expect(copy).not.toBe(d)
    expect(copy.forms).not.toBe(d.forms)
    expect(copy.forms[0]).not.toBe(d.forms[0])

    // Mutating the copy must never touch the original.
    copy.forms[0].name = 'Mutated'
    expect(d.forms[0].name).toBe('Original')
  })

  it('duplicateTitle defaults to "<title> (copy)" when no explicit title is given', () => {
    expect(duplicateTitle('My Diagram')).toBe('My Diagram (copy)')
  })

  it('duplicateTitle uses the explicit title when one is given', () => {
    expect(duplicateTitle('My Diagram', 'A Whole New Title')).toBe('A Whole New Title')
  })
})
