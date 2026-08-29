import { describe, expect, it } from 'vitest'
import { geometryFor, BASE_SIZE } from '../../components/editor/domain/forms'
import { restoreDiagram } from '../../components/editor/persist/io'
import type { Diagram } from '../../components/editor/domain/types'

// Every corner/vertex of every polygon form, plus two interior centre points on
// square/circle/rhombus, are addressable single-slot attachment points — the
// generalized triangle-`peak`. These lock that behaviour.
describe('corner & centre spot slots', () => {
  it('each shape declares its corner/centre spot keys + the identity centre (empty unchanged)', () => {
    expect(geometryFor('square').edgeKeys).toEqual(['top', 'right', 'bottom', 'left', 'corner-tl', 'corner-tr', 'corner-br', 'corner-bl', 'center-up', 'center-down', 'center'])
    expect(geometryFor('circle').edgeKeys).toEqual(['up', 'right', 'down', 'left', 'center-up', 'center-down', 'center'])
    expect(geometryFor('rhombus').edgeKeys).toEqual(['top-right', 'bottom-right', 'bottom-left', 'top-left', 'corner-top', 'corner-right', 'corner-bottom', 'corner-left', 'center-up', 'center-down', 'center'])
    expect(geometryFor('triangle').edgeKeys).toEqual(['a', 'b', 'c', 'peak', 'corner-base-top', 'corner-base-bottom', 'center-up', 'center'])
    expect(geometryFor('circle').edgeKeys).not.toContain('corner-tl') // circle is smooth — no vertices
    expect(geometryFor('triangle').edgeKeys).toContain('center-up') // triangle's one interior spot: centroid→apex midpoint
    expect(geometryFor('triangle').edgeKeys).toContain('center')
    expect(geometryFor('empty').edgeKeys).toEqual(['self'])
  })

  it('the identity centre anchors dead-centre with a null (directionless) normal', () => {
    for (const shape of ['square', 'circle', 'rhombus', 'triangle'] as const) {
      const g = geometryFor(shape); const n = BASE_SIZE
      expect(g.pointAnchor('center', 0, 1, n)).toMatchObject({ x: n / 2, y: n / 2 })
      expect(g.pointNormal('center', 0, 1)).toBeNull()
      expect(g.regionShape('center').kind).toBe('spot')
      expect(g.edgeCapacity?.['center']).toBe(1)
    }
  })

  it('square corners anchor exactly at the box vertices', () => {
    const g = geometryFor('square'); const n = BASE_SIZE
    expect(g.pointAnchor('corner-tl', 0, 1, n)).toMatchObject({ x: 0, y: 0 })
    expect(g.pointAnchor('corner-tr', 0, 1, n)).toMatchObject({ x: n, y: 0 })
    expect(g.pointAnchor('corner-br', 0, 1, n)).toMatchObject({ x: n, y: n })
    expect(g.pointAnchor('corner-bl', 0, 1, n)).toMatchObject({ x: 0, y: n })
  })

  it('centre spots anchor on the vertical midline — one up, one down of centre', () => {
    for (const shape of ['square', 'circle', 'rhombus'] as const) {
      const g = geometryFor(shape); const n = BASE_SIZE
      expect(g.pointAnchor('center-up', 0, 1, n)).toMatchObject({ x: n / 2, y: 0.25 * n })
      expect(g.pointAnchor('center-down', 0, 1, n)).toMatchObject({ x: n / 2, y: 0.75 * n })
    }
  })

  it('edgeAt resolves corners near a vertex, but never the interior centres', () => {
    const g = geometryFor('square')
    // ONE pipeline: edgeAt resolves EVERY spot (corner AND centre) within its
    // disc, then falls back to the nearest side.
    expect(g.edgeAt(0.02, 0.02)).toBe('corner-tl')
    expect(g.edgeAt(0.98, 0.02)).toBe('corner-tr')
    expect(g.edgeAt(0.98, 0.98)).toBe('corner-br')
    expect(g.edgeAt(0.5, 0.03)).toBe('top') // near an edge, no spot → the side
  })

  it('edgeAt resolves the interior centres too (nearest wins), else a side/arc', () => {
    const g = geometryFor('circle')
    expect(g.edgeAt(0.5, 0.25)).toBe('center-up')
    expect(g.edgeAt(0.5, 0.75)).toBe('center-down')
    expect(g.edgeAt(0.5, 0.5)).toBe('center') // dead centre = the identity spot
    expect(g.edgeAt(0.5, 0.02)).toBe('up') // off every centre → the nearest arc
    expect(geometryFor('triangle').edgeAt(0.5, 0.5)).toBe('center') // triangle centroid = its identity centre
    expect(geometryFor('empty').edgeAt(0.9, 0.9)).toBe('self') // empty is always its one self-region
  })

  it('corner & centre spots each cap at one point (like peak)', () => {
    const g = geometryFor('square')
    for (const k of ['corner-tl', 'corner-tr', 'corner-br', 'corner-bl', 'center-up', 'center-down']) {
      expect(g.edgeCapacity?.[k]).toBe(1)
    }
    // sides stay uncapped
    expect(g.edgeCapacity?.['top']).toBeUndefined()
  })

  it('corner & centre regions render as spots; sides stay stripes', () => {
    const g = geometryFor('rhombus')
    expect(g.regionShape('corner-top').kind).toBe('spot')
    expect(g.regionShape('center-up').kind).toBe('spot')
    expect(g.regionShape('top-right').kind).toBe('polyline')
  })

  it('triangle center-up anchors at the centroid→apex midpoint, one spot, capacity 1', () => {
    const g = geometryFor('triangle'); const n = BASE_SIZE
    expect(g.pointAnchor('center-up', 0, 1, n)).toMatchObject({ x: 0.75 * n, y: 0.5 * n })
    expect(g.regionShape('center-up').kind).toBe('spot')
    expect(g.edgeCapacity?.['center-up']).toBe(1)
  })

  it('a square with a corner point and a centre point round-trips byte-for-byte', () => {
    const d: Diagram = {
      schemaVersion: 1,
      forms: [{
        id: 'F', shape: 'square', position: { x: 0, y: 0 },
        edges: { top: [], right: [], bottom: [], left: [], 'corner-tl': ['C'], 'corner-tr': [], 'corner-br': [], 'corner-bl': [], 'center-up': ['M'], 'center-down': [], 'center': [] },
      }],
      points: {
        C: { id: 'C', shape: 'empty', name: 'i', formId: 'F', edgeKey: 'corner-tl' },
        M: { id: 'M', shape: 'empty', name: '0', formId: 'F', edgeKey: 'center-up' },
      },
      lines: [],
    }
    const r = restoreDiagram(d)
    const f = r.forms.find((x) => x.id === 'F')!
    expect(f.edges['corner-tl']).toEqual(['C'])
    expect(f.edges['center-up']).toEqual(['M'])
    // the new keys must survive io's legacy-corner drop (CORNER_KEY_RE = /^v\d+$/)
    expect(JSON.stringify(r)).toBe(JSON.stringify(d))
  })
})
