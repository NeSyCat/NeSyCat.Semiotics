// Test suite for domain/wirepath.ts — the single source of truth for wire
// curve/route geometry, shared by ui/LineEdge.tsx (canvas) and
// ir/geometry-ir.ts (both exporters). Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { wirePath, dirFromCardinal, smoothstepElbowPoints, EDGE_STYLES, STEP_RADIUS } from '../../components/editor/domain/wirepath'

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol
}

describe('wirepath.ts', () => {
  it('EDGE_STYLES lists all three styles', () => {
    expect(EDGE_STYLES).toEqual(['straight', 'bezier', 'smoothstep'])
  })

  it('dirFromCardinal maps React Flow/anchor cardinals to outward Dirs', () => {
    expect(dirFromCardinal('top')).toBe('up')
    expect(dirFromCardinal('right')).toBe('right')
    expect(dirFromCardinal('bottom')).toBe('down')
    expect(dirFromCardinal('left')).toBe('left')
    expect(dirFromCardinal(undefined)).toBeNull()
    expect(dirFromCardinal(null)).toBeNull()
    expect(dirFromCardinal('nonsense')).toBeNull()
  })

  describe('straight', () => {
    it('is a plain M...L path with the exact midpoint', () => {
      const { d, c1, c2, mid } = wirePath(0, 0, 'right', 100, 40, 'left', 'straight')
      expect(d).toBe('M 0 0 L 100 40')
      expect(c1).toBeUndefined()
      expect(c2).toBeUndefined()
      expect(mid).toEqual({ x: 50, y: 20 })
    })
  })

  describe('bezier', () => {
    it('control points leave along each Dir, scaled by clamp(0.5*dist, 24, 220)', () => {
      // dist = 200 -> k = 100 (within [24,220])
      const sx = 0, sy = 0, tx = 200, ty = 0
      const { c1, c2 } = wirePath(sx, sy, 'right', tx, ty, 'left', 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        // source leaves 'right' (unit +x) by k=100
        expect(approx(c1.x, sx + 100)).toBe(true)
        expect(approx(c1.y, sy)).toBe(true)
        // target leaves 'left' (unit -x) by k=100
        expect(approx(c2.x, tx - 100)).toBe(true)
        expect(approx(c2.y, ty)).toBe(true)
      }
    })

    it('k is clamped to a minimum of 24 for very short wires', () => {
      const { c1 } = wirePath(0, 0, 'right', 10, 0, 'left', 'bezier')
      expect(c1).toBeDefined()
      if (c1) expect(approx(c1.x, 24)).toBe(true) // clamp(0.5*10, 24, 220) = 24
    })

    it('k is clamped to a maximum of 220 for very long wires', () => {
      const { c1 } = wirePath(0, 0, 'right', 1000, 0, 'left', 'bezier')
      expect(c1).toBeDefined()
      if (c1) expect(approx(c1.x, 220)).toBe(true) // clamp(500, 24, 220) = 220
    })

    it('a null Dir leaves straight toward the other endpoint', () => {
      // Horizontal line, source Dir null -> control point continues straight
      // along +x (toward the target) instead of picking an arbitrary axis.
      const { c1, c2 } = wirePath(0, 0, null, 200, 0, null, 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        expect(approx(c1.y, 0)).toBe(true)
        expect(c1.x).toBeGreaterThan(0) // toward the target
        expect(approx(c2.y, 0)).toBe(true)
        expect(c2.x).toBeLessThan(200) // toward the source
      }
    })

    it('a free source end (null Dir) with a directed target: source control point lies on the chord toward the target, target control point offsets along its own Dir', () => {
      // The copy-node fan-out case (Canvas.tsx's sourceFree/geometry-ir.ts's
      // pointDir): only the SOURCE is a free end — the target still has a
      // real outward Dir and must still offset normally.
      const sx = 50, sy = 50, tx = 300, ty = 100
      const { c1, c2 } = wirePath(sx, sy, null, tx, ty, 'left', 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        // c1 collinear with the (source -> target) chord: cross product of
        // (c1-source) and (target-source) is ~0.
        const cross = (c1.x - sx) * (ty - sy) - (c1.y - sy) * (tx - sx)
        expect(approx(cross, 0, 1e-6)).toBe(true)
        expect(c1.x).toBeGreaterThan(sx) // leaves toward the target, not away

        // c2 offsets from the target along 'left' == unit (-1, 0): x moves,
        // y is unchanged from the target's own y (NOT collinear with the chord).
        expect(approx(c2.y, ty)).toBe(true)
        expect(c2.x).toBeLessThan(tx)
      }
    })

    it('mid is the cubic Bezier point at t=0.5: P0/8 + 3C1/8 + 3C2/8 + P3/8', () => {
      const sx = 0, sy = 0, tx = 200, ty = 0
      const { c1, c2, mid } = wirePath(sx, sy, 'right', tx, ty, 'left', 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        const expectedX = 0.125 * sx + 0.375 * c1.x + 0.375 * c2.x + 0.125 * tx
        const expectedY = 0.125 * sy + 0.375 * c1.y + 0.375 * c2.y + 0.125 * ty
        expect(approx(mid.x, expectedX)).toBe(true)
        expect(approx(mid.y, expectedY)).toBe(true)
      }
    })

    it('the SVG path is a single cubic C command from source to target', () => {
      const { d } = wirePath(0, 0, 'right', 200, 0, 'left', 'bezier')
      expect(d).toMatch(/^M 0 0 C .+, .+, 200 0$/)
    })
  })

  describe('smoothstep (custom orthogonal router)', () => {
    it('elbow points start/end exactly at the raw endpoints', () => {
      const pts = smoothstepElbowPoints(0, 0, 'right', 200, 100, 'left')
      expect(pts[0]).toEqual({ x: 0, y: 0 })
      expect(pts[pts.length - 1]).toEqual({ x: 200, y: 100 })
    })

    it('a non-null Dir offsets its stub by STEP_OFFSET=24 along that Dir', () => {
      const pts = smoothstepElbowPoints(0, 0, 'right', 200, 100, 'left')
      // second point is the source's outward stub: +24 along 'right' (+x)
      expect(pts[1]).toEqual({ x: 24, y: 0 })
      // second-to-last is the target's outward stub: +24 along 'left' from
      // the target's own position means the stub sits at tx - 24 (since
      // 'left' unit is -x, applied AT the target and pointing outward).
      expect(pts[pts.length - 2]).toEqual({ x: 176, y: 100 })
    })

    it('a null Dir has no stub — the elbow route starts/continues directly from that endpoint', () => {
      const pts = smoothstepElbowPoints(0, 0, null, 200, 0, null)
      // No stub inserted for either end: point count is endpoint + 2 elbow
      // corners + endpoint = 4 (elbow corners collapse toward the single
      // mid-X line since both endpoints share y=0, deduping to fewer points,
      // but none of them may equal a 24px-offset stub).
      for (const p of pts) {
        expect(p.x).not.toBe(24)
        expect(p.x).not.toBe(176)
      }
    })

    it('horizontal source Dir picks a mid-X elbow (turn axis is vertical)', () => {
      const pts = smoothstepElbowPoints(0, 0, 'right', 200, 100, 'left')
      // The two middle corner points share the same x (the mid-X turn line).
      const midX = pts[2].x
      expect(approx(pts[3].x, midX)).toBe(true)
      expect(approx(pts[2].y, 0)).toBe(true) // aligned with the source stub's y
      expect(approx(pts[3].y, 100)).toBe(true) // aligned with the target stub's y
    })

    it('vertical source Dir picks a mid-Y elbow (turn axis is horizontal)', () => {
      const pts = smoothstepElbowPoints(0, 0, 'down', 200, 100, 'up')
      const midY = pts[2].y
      expect(approx(pts[3].y, midY)).toBe(true)
      expect(approx(pts[2].x, 0)).toBe(true)
      expect(approx(pts[3].x, 200)).toBe(true)
    })

    it('null source Dir with a horizontally-dominant delta behaves like a horizontal Dir', () => {
      const withNull = smoothstepElbowPoints(0, 0, null, 300, 10, null)
      const midX = withNull.find((p) => p !== withNull[0] && p !== withNull[withNull.length - 1])?.x
      expect(midX).toBeDefined()
      // Every interior point's x should equal the same mid-X turn line.
      const interior = withNull.slice(1, -1)
      for (const p of interior) expect(approx(p.x, midX!)).toBe(true)
    })

    it('mid is the geometric midpoint of the middle segment', () => {
      const { mid } = wirePath(0, 0, 'right', 200, 100, 'left', 'smoothstep')
      const pts = smoothstepElbowPoints(0, 0, 'right', 200, 100, 'left')
      // Middle segment is the pair of points sharing the elbow's turn
      // coordinate — indices 2 and 3 given a full [S,S1,mid1,mid2,T1,T] route.
      const mid1 = pts[2]
      const mid2 = pts[3]
      expect(approx(mid.x, (mid1.x + mid2.x) / 2)).toBe(true)
      expect(approx(mid.y, (mid1.y + mid2.y) / 2)).toBe(true)
    })

    it('the SVG path rounds each interior corner with a quarter-circle arc (radius <= STEP_RADIUS)', () => {
      const { d } = wirePath(0, 0, 'right', 200, 100, 'left', 'smoothstep')
      const arcs = [...d.matchAll(/A ([\d.]+) ([\d.]+) 0 0 [01]/g)]
      expect(arcs.length).toBeGreaterThan(0)
      for (const [, rx] of arcs) expect(Number(rx)).toBeLessThanOrEqual(STEP_RADIUS + 1e-6)
    })

    it('a short adjacent segment shrinks the corner radius below STEP_RADIUS instead of overshooting', () => {
      // Source stub (24px) meets an elbow segment shorter than 2*STEP_RADIUS.
      const { d } = wirePath(0, 0, 'right', 26, 1, 'left', 'smoothstep')
      const arcs = [...d.matchAll(/A ([\d.]+) /g)]
      for (const [, r] of arcs) expect(Number(r)).toBeLessThan(STEP_RADIUS)
    })
  })

  describe('cross-style structural sanity', () => {
    it('every style returns a finite mid and a non-empty d for the same endpoints', () => {
      for (const style of EDGE_STYLES) {
        const { d, mid } = wirePath(10, -20, 'right', 130, 60, 'up', style)
        expect(d.length).toBeGreaterThan(0)
        expect(Number.isFinite(mid.x)).toBe(true)
        expect(Number.isFinite(mid.y)).toBe(true)
      }
    })
  })
})
