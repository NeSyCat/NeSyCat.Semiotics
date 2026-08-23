import { describe, expect, it } from 'vitest'
import { restoreDiagram } from '../../components/editor/persist/io'
import type { Diagram } from '../../components/editor/domain/types'

// Regression: the MCP create_diagram/update_diagram tools deliver `data` as a
// JSON STRING, and restoreDiagram used to collapse any non-object to an empty
// diagram — so every drawn diagram saved empty. It must now parse a string.
describe('restoreDiagram: string vs object input', () => {
  const d: Diagram = {
    schemaVersion: 1,
    forms: [{ id: 'f1', name: '\\mathtt{Cell}', shape: 'square', position: { x: 0, y: 0 }, edges: { top: ['p1'], right: [], bottom: [], left: [] } }],
    points: { p1: { id: 'p1', shape: 'square', formId: 'f1', edgeKey: 'top' } },
    lines: [],
  }

  it('keeps content when given a parsed object', () => {
    const out = restoreDiagram(d)
    expect(out.forms).toHaveLength(1)
    expect(Object.keys(out.points)).toEqual(['p1'])
  })

  it('keeps content when given the SAME diagram as a JSON string', () => {
    const out = restoreDiagram(JSON.stringify(d))
    expect(out.forms).toHaveLength(1)
    expect(out.forms[0].id).toBe('f1')
    expect(Object.keys(out.points)).toEqual(['p1'])
  })

  it('string and object inputs produce the identical result', () => {
    expect(restoreDiagram(JSON.stringify(d))).toEqual(restoreDiagram(d))
  })

  it('falls back to an empty diagram for a non-JSON string', () => {
    const out = restoreDiagram('not json at all')
    expect(out.forms).toHaveLength(0)
    expect(out.lines).toHaveLength(0)
  })

  it('falls back to an empty diagram for other non-objects', () => {
    expect(restoreDiagram(123).forms).toHaveLength(0)
    expect(restoreDiagram(null).forms).toHaveLength(0)
    expect(restoreDiagram(undefined).forms).toHaveLength(0)
  })
})
