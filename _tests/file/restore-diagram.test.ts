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

// edgeStyle round trip — the wire-style ticket's persistence contract:
// missing/invalid -> absent (meaning 'straight', old docs unaffected);
// 'bezier'/'smoothstep' survive; an explicit 'straight' collapses back to
// absent (same "clears to the default" idiom as rotation/scale/color).
describe('restoreDiagram: edgeStyle normalization', () => {
  it('a document with no edgeStyle field restores with edgeStyle absent', () => {
    const out = restoreDiagram({ schemaVersion: 1, forms: [], points: {}, lines: [] })
    expect(out.edgeStyle).toBeUndefined()
  })

  it("'bezier' round-trips as-is", () => {
    const out = restoreDiagram({ schemaVersion: 1, forms: [], points: {}, lines: [], edgeStyle: 'bezier' })
    expect(out.edgeStyle).toBe('bezier')
  })

  it("'smoothstep' round-trips as-is", () => {
    const out = restoreDiagram({ schemaVersion: 1, forms: [], points: {}, lines: [], edgeStyle: 'smoothstep' })
    expect(out.edgeStyle).toBe('smoothstep')
  })

  it("an explicit 'straight' normalizes to absent (the implicit default)", () => {
    const out = restoreDiagram({ schemaVersion: 1, forms: [], points: {}, lines: [], edgeStyle: 'straight' })
    expect(out.edgeStyle).toBeUndefined()
  })

  it('an invalid/unknown edgeStyle value drop-silently normalizes to absent', () => {
    const out = restoreDiagram({ schemaVersion: 1, forms: [], points: {}, lines: [], edgeStyle: 'wiggly' })
    expect(out.edgeStyle).toBeUndefined()
  })

  it('survives a JSON-string round trip (the MCP create/update_diagram path)', () => {
    const d = { schemaVersion: 1, forms: [], points: {}, lines: [], edgeStyle: 'bezier' }
    expect(restoreDiagram(JSON.stringify(d)).edgeStyle).toBe('bezier')
  })
})
