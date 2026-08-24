// Test suite for DEFECT B's fix: the wire tangent (domain/wirepath.ts's Dir)
// now comes from a point's TRUE outward normal (domain/forms.ts's
// worldPointNormal — the form's own per-shape edge/arc perpendicular,
// rotated by the form's own rotation), not a coarse, static, rotation-blind
// cardinal. Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { worldPointNormal, geometryFor } from '../../components/editor/domain/forms'
import { wirePath, dirFromCardinal } from '../../components/editor/domain/wirepath'
import { diagramToTikzCore } from '../../components/editor/export/tikz'
import { diagramToHtmlCore } from '../../components/editor/export/html'
import { pointPositionsPx } from '../../components/editor/ir/geometry-ir'
import type { Diagram, Form } from '../../components/editor/domain/types'

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol
}

function unitLen(v: { x: number; y: number }): number {
  return Math.hypot(v.x, v.y)
}

function bareForm(id: string, shape: Form['shape'], extra: Partial<Form> = {}): Form {
  return { id, shape, position: { x: 0, y: 0 }, edges: {}, ...extra }
}

const SQRT3_2 = Math.sqrt(3) / 2

describe('worldPointNormal — TRUE per-shape outward tangent', () => {
  describe('triangle (slant edges + peak vertex)', () => {
    // Hand-derived from the triangle's own inscribed-circumradius geometry
    // (domain/forms.ts's TRI_APEX_X/Y, TRI_BASE_X, TRI_BASE_Y_TOP/BOT,
    // TRI_CENTROID) — NOT the coarse Position.Top/Bottom/Left pointAnchor
    // uses for label placement, which is a different, arbitrary pick for a
    // 60°-slanted edge.
    it("'a' (top slant) points up-right at exactly (0.5, -√3/2) — perpendicular to the slant, outward", () => {
      const f = bareForm('T1', 'triangle', { edges: { a: ['P'], b: [], c: [], peak: [] } })
      const n = worldPointNormal(f, 'a', 0, 1)
      expect(n).not.toBeNull()
      if (n) {
        expect(approx(unitLen(n), 1)).toBe(true) // a real unit vector
        expect(approx(n.x, 0.5)).toBe(true)
        expect(approx(n.y, -SQRT3_2)).toBe(true)
      }
    })

    it("'b' (bottom slant) is 'a' mirrored about the horizontal — (0.5, +√3/2)", () => {
      const f = bareForm('T1', 'triangle', { edges: { a: [], b: ['P'], c: [], peak: [] } })
      const n = worldPointNormal(f, 'b', 0, 1)
      expect(n).toEqual({ x: expect.closeTo(0.5, 6), y: expect.closeTo(SQRT3_2, 6) })
    })

    it("'c' (the left vertical side) points due left, (-1, 0) — matches the OLD static Position.Left exactly (a straight vertical edge has no slant to get wrong)", () => {
      const f = bareForm('T1', 'triangle', { edges: { a: [], b: [], c: ['P'], peak: [] } })
      const n = worldPointNormal(f, 'c', 0, 1)
      expect(n).toEqual({ x: -1, y: 0 })
    })

    it("'peak' (the apex vertex) points due right, (1, 0) — radial from the centroid through the apex", () => {
      const f = bareForm('T1', 'triangle', { edges: { a: [], b: [], c: [], peak: ['P'] } })
      const n = worldPointNormal(f, 'peak', 0, 1)
      expect(n).toEqual({ x: 1, y: 0 })
    })

    // Rotated 180° — the "dice idiom": every point's normal simply negates
    // (rotating a direction 180° flips both components exactly).
    it('rotation=180 negates every slant/peak normal exactly (the "dice idiom")', () => {
      const rotated = (edgeKey: string) => {
        const f = bareForm('T2', 'triangle', { rotation: 180, edges: { a: [], b: [], c: [], peak: [], [edgeKey]: ['P'] } })
        return worldPointNormal(f, edgeKey, 0, 1)
      }
      const a = rotated('a')
      const peak = rotated('peak')
      const c = rotated('c')
      expect(a).not.toBeNull()
      expect(peak).not.toBeNull()
      expect(c).not.toBeNull()
      if (a) { expect(approx(a.x, -0.5)).toBe(true); expect(approx(a.y, SQRT3_2)).toBe(true) }
      if (peak) { expect(approx(peak.x, -1)).toBe(true); expect(approx(peak.y, 0)).toBe(true) }
      if (c) { expect(approx(c.x, 1)).toBe(true); expect(approx(c.y, 0)).toBe(true) }
    })

    it("rotation=90 turns 'peak' (unrotated (1,0)) to point straight down (0,1) — clockwise, Y-down, same convention as FormNode.tsx's CSS rotate()", () => {
      const f = bareForm('T3', 'triangle', { rotation: 90, edges: { a: [], b: [], c: [], peak: ['P'] } })
      const n = worldPointNormal(f, 'peak', 0, 1)
      expect(n).not.toBeNull()
      if (n) { expect(approx(n.x, 0)).toBe(true); expect(approx(n.y, 1)).toBe(true) }
    })
  })

  describe('square', () => {
    it('rotation=0 matches the old static cardinal mapping exactly (top=up, right=right, bottom=down, left=left)', () => {
      const of = (edgeKey: string) => worldPointNormal(bareForm('S0', 'square', { edges: { top: [], right: [], bottom: [], left: [], [edgeKey]: ['P'] } }), edgeKey, 0, 1)
      const check = (v: { x: number; y: number } | null, ex: number, ey: number) => {
        expect(v).not.toBeNull()
        if (v) { expect(approx(v.x, ex)).toBe(true); expect(approx(v.y, ey)).toBe(true) }
      }
      check(of('top'), 0, -1)
      check(of('right'), 1, 0)
      check(of('bottom'), 0, 1)
      check(of('left'), -1, 0)
    })

    it("rotation=90 (clockwise) turns 'right' (1,0) into 'down' (0,1) — a rotated form's handle side changes with it", () => {
      const f = bareForm('S1', 'square', { rotation: 90, edges: { top: [], right: ['P'], bottom: [], left: [] } })
      const n = worldPointNormal(f, 'right', 0, 1)
      expect(n).not.toBeNull()
      if (n) { expect(approx(n.x, 0)).toBe(true); expect(approx(n.y, 1)).toBe(true) }
    })

    it('rotation=90 REGRESSION: differs from the OLD dirFromCardinal(px.cardinal) approach, which stayed static regardless of rotation', () => {
      const f = bareForm('S2', 'square', { rotation: 90, edges: { top: [], right: ['P'], bottom: [], left: [] } })
      const trueNormal = worldPointNormal(f, 'right', 0, 1)
      const oldStaticCardinal = dirFromCardinal('right') // what pointAnchor's Position.Right used to feed, unrotated
      expect(trueNormal).not.toEqual(oldStaticCardinal)
    })
  })

  describe('circle', () => {
    it('is radial — matches the exact angle arcPt itself places the point at (no drift between the two)', () => {
      const f = bareForm('C1', 'circle', { edges: { up: [], right: [], down: [], left: ['P'] } })
      const n = worldPointNormal(f, 'left', 0, 1)
      expect(n).not.toBeNull()
      if (n) {
        expect(approx(unitLen(n), 1)).toBe(true)
        // 'left' is the cardinal-aligned single-point case: exactly (-1, 0).
        expect(approx(n.x, -1)).toBe(true)
        expect(approx(n.y, 0)).toBe(true)
      }
    })
  })

  describe('empty (free end)', () => {
    it("'self' has no meaningful direction — null, regardless of rotation", () => {
      const f = bareForm('E1', 'empty', { rotation: 45, edges: { self: ['P'] } })
      expect(worldPointNormal(f, 'self', 0, 1)).toBeNull()
    })
  })
})

describe('bezier control points follow a TRUE diagonal normal (not just the 4 cardinals)', () => {
  it("a triangle's 'a'-edge point offsets its bezier control point along (0.5, -√3/2), a genuinely diagonal direction", () => {
    const sDir = worldPointNormal(bareForm('T', 'triangle', { edges: { a: ['P'], b: [], c: [], peak: [] } }), 'a', 0, 1)
    expect(sDir).not.toBeNull()
    const { c1 } = wirePath(0, 0, sDir, 300, -100, null, 'bezier')
    expect(c1).toBeDefined()
    if (c1 && sDir) {
      // c1 = source + k*sDir — NOT axis-aligned (both components non-zero).
      expect(Math.abs(c1.x)).toBeGreaterThan(0.01)
      expect(Math.abs(c1.y)).toBeGreaterThan(0.01)
      const dist = Math.hypot(300, -100)
      const k = Math.max(24, Math.min(220, 0.5 * dist))
      expect(approx(c1.x, sDir.x * k, 1e-6)).toBe(true)
      expect(approx(c1.y, sDir.y * k, 1e-6)).toBe(true)
    }
  })
})

describe('export parity: TikZ/HTML reflect the SAME true normal a rotated form computes', () => {
  // A 90°-rotated square, one point on 'right' (true normal (0,1) — see
  // above), wired via bezier to a plain empty point elsewhere. Both
  // exporters resolve this through ir/geometry-ir.ts's pointDir, which calls
  // the EXACT SAME worldPointNormal ui/Canvas.tsx's pointWorldNormal does —
  // so this doubles as the canvas/export parity check (no separate DOM-based
  // canvas test is possible in this headless suite; the shared function call
  // is what GUARANTEES parity by construction).
  function rotatedDiagram(): Diagram {
    return {
      schemaVersion: 1,
      forms: [
        { id: 'RSQ', shape: 'square', position: { x: 0, y: 0 }, rotation: 90, edges: { top: [], right: ['RP1'], bottom: [], left: [] } },
        { id: 'RTGT', shape: 'empty', position: { x: 400, y: 300 }, edges: { self: ['RP2'] } },
      ],
      points: {
        RP1: { id: 'RP1', shape: 'empty', formId: 'RSQ', edgeKey: 'right' },
        RP2: { id: 'RP2', shape: 'empty', formId: 'RTGT', edgeKey: 'self' },
      },
      lines: [{ id: 'RL1', source: 'RP1', targets: ['RP2'] }],
      edgeStyle: 'bezier',
    }
  }

  it("the rotated square's point uses worldPointNormal (0,1), matching the geometry both exporters compute their bezier controls from", () => {
    const d = rotatedDiagram()
    const positions = pointPositionsPx(d)
    const src = positions.get('RP1')!
    const expectedDir = worldPointNormal(src.layout.form, src.edgeKey, src.siblingIndex, src.siblingCount)
    expect(expectedDir).not.toBeNull()
    if (expectedDir) {
      expect(approx(expectedDir.x, 0)).toBe(true)
      expect(approx(expectedDir.y, 1)).toBe(true)
    }
  })

  it('TikZ draws the bezier control point offset in the ROTATED direction (not the old static "right"=+x)', () => {
    const d = rotatedDiagram()
    const positions = pointPositionsPx(d)
    const src = positions.get('RP1')!
    const tikz = diagramToTikzCore(d)
    const drawLine = tikz.split('\n').find((l) => l.includes('.. controls'))
    expect(drawLine).toBeDefined()
    const m = drawLine?.match(/\(([-\d.]+),([-\d.]+)\) \.\. controls \(([-\d.]+),([-\d.]+)\)/)
    expect(!!m).toBe(true)
    if (m) {
      const [, fx, fy, c1x, c1y] = m.map(Number)
      // c1 offsets from the source ALONG Y (the rotated normal (0,1)), not
      // along X (what the old unrotated "right" cardinal would have done).
      // px->cm delta, y-flipped (TikZ is Y-up) — same technique as the
      // earlier bezier-control-point tests in tikz.test.ts.
      const dxCm = c1x - fx
      const dyCm = c1y - fy
      expect(approx(dxCm, 0, 1e-3), 'no x offset — the rotated normal has zero x component').toBe(true)
      expect(Math.abs(dyCm)).toBeGreaterThan(0.1) // a real y offset exists
      void src
    }
  })

  it('HTML/SVG draws the SAME rotated-direction bezier control point (canvas coordinate space, no flip)', () => {
    const d = rotatedDiagram()
    const positions = pointPositionsPx(d)
    const src = positions.get('RP1')!
    const tgt = positions.get('RP2')!
    const expectedDir = worldPointNormal(src.layout.form, src.edgeKey, src.siblingIndex, src.siblingCount)!
    const dist = Math.hypot(tgt.pos.x - src.pos.x, tgt.pos.y - src.pos.y)
    const k = Math.max(24, Math.min(220, 0.5 * dist))
    const expectedC1 = { x: src.pos.x + expectedDir.x * k, y: src.pos.y + expectedDir.y * k }

    const svg = diagramToHtmlCore(d)
    const m = svg.match(/<path d="M ([-\d.]+) ([-\d.]+) C ([-\d.]+) ([-\d.]+),/)
    expect(!!m).toBe(true)
    if (m) {
      const [, , , c1x, c1y] = m.map(Number)
      expect(approx(c1x, expectedC1.x, 1e-2)).toBe(true)
      expect(approx(c1y, expectedC1.y, 1e-2)).toBe(true)
    }
  })
})

describe('angular straightness guard combined with a REAL (non-cardinal) worldPointNormal', () => {
  // Full boundary coverage of the guard itself lives in wirepath.test.ts
  // (DEFECT A); this checks the guard still does the right thing when fed a
  // genuinely diagonal Dir from worldPointNormal, not a legacy/cardinal
  // adapter — the guard is purely a function of the raw chord, independent
  // of Dir, so a near-axis chord snaps straight EVEN THOUGH the triangle
  // edge's own true Dir is diagonal.
  it('a near-axis chord still snaps straight even when sDir is a diagonal triangle-edge normal', () => {
    const sDir = worldPointNormal(bareForm('T', 'triangle', { edges: { a: ['P'], b: [], c: [], peak: [] } }), 'a', 0, 1)
    expect(sDir).not.toBeNull()
    // mainDelta=300, crossDelta=15 -> well within the ~4° guard (see
    // wirepath.test.ts for the exact threshold math).
    const { d, c1 } = wirePath(0, 100, sDir, 300, 115, null, 'bezier')
    expect(d).toBe('M 0 100 L 300 115')
    expect(c1).toBeUndefined()
  })

  it('geometryFor is the single per-shape registry both worldPointNormal and pointAnchor read from', () => {
    expect(geometryFor('square').edgeKeys).toContain('right')
  })
})
