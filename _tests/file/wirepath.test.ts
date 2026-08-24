// Test suite for domain/wirepath.ts — the single source of truth for wire
// curve/route geometry, shared by ui/LineEdge.tsx (canvas) and
// ir/geometry-ir.ts (both exporters). Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { wirePath, dirFromCardinal, dirFromLegacy, smoothstepElbowPoints, isNearlyStraight, EDGE_STYLES, STEP_RADIUS } from '../../components/editor/domain/wirepath'

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol
}

describe('wirepath.ts', () => {
  it('EDGE_STYLES lists all three styles', () => {
    expect(EDGE_STYLES).toEqual(['straight', 'bezier', 'smoothstep'])
  })

  it('dirFromCardinal maps React Flow/anchor cardinals to outward unit vectors', () => {
    expect(dirFromCardinal('top')).toEqual({ x: 0, y: -1 })
    expect(dirFromCardinal('right')).toEqual({ x: 1, y: 0 })
    expect(dirFromCardinal('bottom')).toEqual({ x: 0, y: 1 })
    expect(dirFromCardinal('left')).toEqual({ x: -1, y: 0 })
    expect(dirFromCardinal(undefined)).toBeNull()
    expect(dirFromCardinal(null)).toBeNull()
    expect(dirFromCardinal('nonsense')).toBeNull()
  })

  it('dirFromLegacy (the OLD 4-cardinal Dir spelling) maps to the SAME unit vectors as dirFromCardinal', () => {
    expect(dirFromLegacy('right')).toEqual(dirFromCardinal('right'))
    expect(dirFromLegacy('left')).toEqual(dirFromCardinal('left'))
    expect(dirFromLegacy('up')).toEqual(dirFromCardinal('top'))
    expect(dirFromLegacy('down')).toEqual(dirFromCardinal('bottom'))
    expect(dirFromLegacy(null)).toBeNull()
  })

  describe('straight', () => {
    it('is a plain M...L path with the exact midpoint', () => {
      const { d, c1, c2, mid } = wirePath(0, 0, dirFromLegacy('right'), 100, 40, dirFromLegacy('left'), 'straight')
      expect(d).toBe('M 0 0 L 100 40')
      expect(c1).toBeUndefined()
      expect(c2).toBeUndefined()
      expect(mid).toEqual({ x: 50, y: 20 })
    })
  })

  describe('bezier', () => {
    it('control points leave along each Dir, scaled by clamp(0.5*dist, 24, 220)', () => {
      // (0,0)->(200,70): angle atan(70/200)=19.3° — clear of the straightness
      // guard's 10° threshold, so the curve actually renders. k is derived
      // from the formula, not hardcoded, so this stays exact regardless.
      const sx = 0, sy = 0, tx = 200, ty = 70
      const dist = Math.hypot(tx - sx, ty - sy)
      const k = Math.max(24, Math.min(220, 0.5 * dist))
      const { c1, c2 } = wirePath(sx, sy, dirFromLegacy('right'), tx, ty, dirFromLegacy('left'), 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        // source leaves 'right' (unit +x) by k — its OWN Dir, independent of
        // the chord's own angle.
        expect(approx(c1.x, sx + k)).toBe(true)
        expect(approx(c1.y, sy)).toBe(true)
        // target leaves 'left' (unit -x) by k
        expect(approx(c2.x, tx - k)).toBe(true)
        expect(approx(c2.y, ty)).toBe(true)
      }
    })

    it('k is clamped to a minimum of 24 for very short wires', () => {
      // (0,0)->(10,3): short, but angle atan(3/10)=16.7° clears the
      // straightness guard (crossDelta=3 > max(1, tan4°*10)=1).
      const { c1 } = wirePath(0, 0, dirFromLegacy('right'), 10, 3, dirFromLegacy('left'), 'bezier')
      expect(c1).toBeDefined()
      if (c1) expect(approx(c1.x, 24)).toBe(true) // clamp(0.5*hypot(10,3), 24, 220) = 24
    })

    it('k is clamped to a maximum of 220 for very long wires', () => {
      // (0,0)->(1000,250): angle atan(250/1000)=14° clears the 10° guard.
      const { c1 } = wirePath(0, 0, dirFromLegacy('right'), 1000, 250, dirFromLegacy('left'), 'bezier')
      expect(c1).toBeDefined()
      if (c1) expect(approx(c1.x, 220)).toBe(true) // clamp(0.5*hypot(1000,250), 24, 220) = 220
    })

    it('a null Dir leaves straight toward the other endpoint', () => {
      // (0,0)->(200,80): angle atan(80/200)=21.8°, clear of the straightness
      // guard — source Dir null -> control point continues along the chord
      // toward the target (collinear), not an arbitrary axis.
      const sx = 0, sy = 0, tx = 200, ty = 80
      const { c1, c2 } = wirePath(sx, sy, null, tx, ty, null, 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        const cross1 = (c1.x - sx) * (ty - sy) - (c1.y - sy) * (tx - sx)
        expect(approx(cross1, 0, 1e-6), 'c1 collinear with the source->target chord').toBe(true)
        expect(c1.x).toBeGreaterThan(sx) // toward the target
        const cross2 = (c2.x - tx) * (sy - ty) - (c2.y - ty) * (sx - tx)
        expect(approx(cross2, 0, 1e-6), 'c2 collinear with the target->source chord').toBe(true)
        expect(c2.x).toBeLessThan(tx) // toward the source
      }
    })

    it('a free source end (null Dir) with a directed target: source control point lies on the chord toward the target, target control point offsets along its own Dir', () => {
      // The copy-node fan-out case (Canvas.tsx's sourceFree/geometry-ir.ts's
      // pointDir): only the SOURCE is a free end — the target still has a
      // real outward Dir and must still offset normally. dx=250,dy=80
      // (angle ≈17.7°) clears the 10° straightness guard with margin.
      const sx = 50, sy = 50, tx = 300, ty = 130
      const { c1, c2 } = wirePath(sx, sy, null, tx, ty, dirFromLegacy('left'), 'bezier')
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
      const sx = 0, sy = 0, tx = 200, ty = 70 // angle 19.3° clears the straightness guard
      const { c1, c2, mid } = wirePath(sx, sy, dirFromLegacy('right'), tx, ty, dirFromLegacy('left'), 'bezier')
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
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 200, 70, dirFromLegacy('left'), 'bezier')
      expect(d).toMatch(/^M 0 0 C .+, .+, 200 70$/)
    })
  })

  describe('smoothstep (custom orthogonal router)', () => {
    it('elbow points start/end exactly at the raw endpoints', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
      expect(pts[0]).toEqual({ x: 0, y: 0 })
      expect(pts[pts.length - 1]).toEqual({ x: 200, y: 100 })
    })

    it('a non-null Dir offsets its stub by STEP_OFFSET=24 along that Dir', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
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
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
      // The two middle corner points share the same x (the mid-X turn line).
      const midX = pts[2].x
      expect(approx(pts[3].x, midX)).toBe(true)
      expect(approx(pts[2].y, 0)).toBe(true) // aligned with the source stub's y
      expect(approx(pts[3].y, 100)).toBe(true) // aligned with the target stub's y
    })

    it('vertical source Dir picks a mid-Y elbow (turn axis is horizontal)', () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('down'), 200, 100, dirFromLegacy('up'))
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
      const { mid } = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep')
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
      // Middle segment is the pair of points sharing the elbow's turn
      // coordinate — indices 2 and 3 given a full [S,S1,mid1,mid2,T1,T] route.
      const mid1 = pts[2]
      const mid2 = pts[3]
      expect(approx(mid.x, (mid1.x + mid2.x) / 2)).toBe(true)
      expect(approx(mid.y, (mid1.y + mid2.y) / 2)).toBe(true)
    })

    it('the SVG path rounds each interior corner with a quarter-circle arc (radius <= STEP_RADIUS)', () => {
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep')
      const arcs = [...d.matchAll(/A ([\d.]+) ([\d.]+) 0 0 [01]/g)]
      expect(arcs.length).toBeGreaterThan(0)
      for (const [, rx] of arcs) expect(Number(rx)).toBeLessThanOrEqual(STEP_RADIUS + 1e-6)
    })

    it('a short adjacent segment shrinks the corner radius below STEP_RADIUS instead of overshooting', () => {
      // Source stub (24px) meets an elbow segment shorter than 2*STEP_RADIUS.
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 26, 1, dirFromLegacy('left'), 'smoothstep')
      const arcs = [...d.matchAll(/A ([\d.]+) /g)]
      for (const [, r] of arcs) expect(Number(r)).toBeLessThan(STEP_RADIUS)
    })

    it('endpoints exactly level on the cross axis (delta 0) collapse to a plain straight path — no elbow', () => {
      const { d, c1, c2 } = wirePath(0, 100, dirFromLegacy('right'), 300, 100, dirFromLegacy('left'), 'smoothstep')
      expect(d).toBe('M 0 100 L 300 100')
      expect(d).not.toContain('A ')
      expect(c1).toBeUndefined() // straightPath's own shape — no bezier controls
      expect(c2).toBeUndefined()
    })
  })

  // ── Angular straightness guard (DEFECT A, recalibrated) ──────────────
  // Replaces an earlier FIXED 1px cross-axis snap, which was too timid: a
  // real user export showed a visible bump/S-curve on a wire whose
  // cross-axis delta was tens of px over a ~100-300px run — well past 1px,
  // but still a shallow, "basically straight" ANGLE. The right measure is
  // the angle off the chord's own dominant axis, not a raw pixel count —
  // see wirepath.ts's isNearlyStraight / STRAIGHT_ANGLE_DEG (10°, recalibrated
  // from an initial 4° once real bumpy-wire measurements — ~11-17px over
  // ~100-150px, ≈6-10° — turned out to sit ABOVE 4°, so those wires were
  // still jogging) / STRAIGHT_MIN_PX (a 1px floor for very short wires,
  // where even a shallow angle is only a couple of px). Applies to BOTH
  // curved styles.
  describe('angular straightness guard (isNearlyStraight)', () => {
    it('a chord within ~10° of its dominant axis snaps straight (smoothstep)', () => {
      // mainDelta=300 -> angular threshold = 300*tan(10°) ≈ 52.9px;
      // crossDelta=40 (angle ≈7.6°) sits clearly inside it.
      const { d } = wirePath(0, 100, dirFromLegacy('right'), 300, 140, dirFromLegacy('left'), 'smoothstep')
      expect(d).toBe('M 0 100 L 300 140')
      expect(d).not.toContain('A ')
    })

    it('a chord past ~10° of its dominant axis (≥12°) still routes a real elbow (smoothstep)', () => {
      // crossDelta=65 (angle ≈12.25°) sits clearly past the same ≈52.9px threshold.
      const { d } = wirePath(0, 100, dirFromLegacy('right'), 300, 165, dirFromLegacy('left'), 'smoothstep')
      expect(d).toContain('A ')
    })

    it('the SAME angular guard applies to bezier, not just smoothstep — a near-axis wire no longer draws a curve', () => {
      const { d, c1, c2 } = wirePath(0, 100, dirFromLegacy('right'), 300, 140, dirFromLegacy('left'), 'bezier')
      expect(d).toBe('M 0 100 L 300 140')
      expect(c1).toBeUndefined()
      expect(c2).toBeUndefined()
    })

    it('past the angular threshold (≥12°), bezier draws a real curve (control points defined)', () => {
      const { d, c1, c2 } = wirePath(0, 100, dirFromLegacy('right'), 300, 165, dirFromLegacy('left'), 'bezier')
      expect(d).toMatch(/^M .+ C .+$/)
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
    })

    it('a very short wire still gets the STRAIGHT_MIN_PX pixel floor even where the angle alone would not snap it', () => {
      // mainDelta=3 -> angular threshold alone = 3*tan(10°) ≈ 0.529px,
      // which crossDelta=0.8 would clear (0.8 > 0.529 -> NOT straight by
      // angle alone) — but the 1px floor wins: max(1, 0.529) = 1, and
      // 0.8 <= 1, so it still snaps straight. A sub-pixel "curve" over 3px
      // isn't worth drawing regardless of what angle it works out to.
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 3, 0.8, dirFromLegacy('left'), 'smoothstep')
      expect(d).toBe('M 0 0 L 3 0.8')
    })

    it('a vertical-axis wire (mid-Y elbow) gets the SAME angular guard on ITS cross axis (x)', () => {
      const { d } = wirePath(100, 0, dirFromLegacy('down'), 140, 300, dirFromLegacy('up'), 'smoothstep')
      expect(d).toBe('M 100 0 L 140 300')
      expect(d).not.toContain('A ')
    })

    it('isNearlyStraight is exported and independent of Dir — pure function of the raw chord', () => {
      expect(isNearlyStraight(0, 100, 300, 140)).toBe(true)
      expect(isNearlyStraight(0, 100, 300, 165)).toBe(false)
      // No Dir args at all in the wirePath calls — confirms the guard is
      // purely geometric, feeding straight into wirePath's own behavior.
      expect(wirePath(0, 0, null, 300, 40, null, 'smoothstep').d).toBe('M 0 0 L 300 40')
      expect(wirePath(0, 0, null, 300, 65, null, 'smoothstep').d).toContain('A ')
    })

    it('a real-world-scale bumpy wire (≈14px over ≈120px, ≈6.6°) — the case this recalibration targets — now snaps straight', () => {
      const { d } = wirePath(0, 0, dirFromLegacy('right'), 120, 14, dirFromLegacy('left'), 'smoothstep')
      expect(d).toBe('M 0 0 L 120 14')
      expect(d).not.toContain('A ')
    })
  })

  // ElbowPlacement — where the router's ONE cross-axis turn sits. Regression
  // for "hyperedge branches share a coincident trunk, smearing the split and
  // hiding the copy point": elbow:'source' moves the turn to the shared
  // source (or exactly the source itself for a free/null-Dir end), so every
  // branch's cross-axis run starts from the same point and fans out
  // immediately instead of all landing on the same mid-line first.
  describe("smoothstep ElbowPlacement ('mid' vs 'source')", () => {
    it("default (no elbow arg) matches passing 'mid' explicitly — single-target lines are UNCHANGED", () => {
      const withDefault = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep')
      const withExplicitMid = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep', 'mid')
      expect(withDefault).toEqual(withExplicitMid)
      const ptsDefault = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'))
      const ptsExplicitMid = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'mid')
      expect(ptsDefault).toEqual(ptsExplicitMid)
    })

    it("elbow:'source' with a non-null source Dir turns immediately after the source's OWN stub, not centered", () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'source')
      // pts: [S, s1, corner2, t1, T] — corner2 is s1 carried onto the
      // target's row (y=100), NOT the mid-X line 'mid' would use (x=100 —
      // see the sibling 'mid' test above, whose corner sits at x=100/200/2).
      expect(pts[1]).toEqual({ x: 24, y: 0 }) // s1: unaffected by elbow placement
      expect(pts[2]).toEqual({ x: 24, y: 100 }) // corner2: turn happens AT s1's own x
    })

    it("elbow:'source' with a null (free-end) source Dir turns EXACTLY at the source — no stub at all", () => {
      const pts = smoothstepElbowPoints(0, 0, null, 200, 100, dirFromLegacy('left'), 'source')
      expect(pts[0]).toEqual({ x: 0, y: 0 }) // the source itself
      // The turn's own corner collapses onto the source (dedup) — the very
      // next point is already the per-target corner, carried onto the
      // target's row (y=100) starting from the source's own x=0.
      expect(pts[1]).toEqual({ x: 0, y: 100 })
    })

    it('two branches from the SAME free-end source diverge at the very first point after the source — they share ONLY the source itself', () => {
      const branchA = smoothstepElbowPoints(0, 0, null, 200, 100, dirFromLegacy('left'), 'source')
      const branchB = smoothstepElbowPoints(0, 0, null, 200, -50, dirFromLegacy('left'), 'source')
      expect(branchA[0]).toEqual(branchB[0]) // the shared source point
      expect(branchA[1]).not.toEqual(branchB[1]) // diverge immediately after
    })

    it("elbow:'source' on a vertical-primary-axis wire turns immediately after the source's stub along x, not centered", () => {
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('down'), 100, 300, dirFromLegacy('up'), 'source')
      expect(pts[1]).toEqual({ x: 0, y: 24 }) // s1
      expect(pts[2]).toEqual({ x: 100, y: 24 }) // corner2: turn happens AT s1's own y
    })

    it("the ≤1px straightness guard still applies under elbow:'source'", () => {
      const { d } = wirePath(0, 100, dirFromLegacy('right'), 300, 100, dirFromLegacy('left'), 'smoothstep', 'source')
      expect(d).toBe('M 0 100 L 300 100')
      expect(d).not.toContain('A ')
    })

    it("mid (the label anchor) for elbow:'source' is the midpoint of the cross-axis segment wherever it now sits", () => {
      const { mid } = wirePath(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'smoothstep', 'source')
      const pts = smoothstepElbowPoints(0, 0, dirFromLegacy('right'), 200, 100, dirFromLegacy('left'), 'source')
      // Cross-axis segment is pts[1]->pts[2] (s1 -> corner2) under 'source',
      // NOT the route's positional middle.
      expect(approx(mid.x, (pts[1].x + pts[2].x) / 2)).toBe(true)
      expect(approx(mid.y, (pts[1].y + pts[2].y) / 2)).toBe(true)
    })
  })

  describe('cross-style structural sanity', () => {
    it('every style returns a finite mid and a non-empty d for the same endpoints', () => {
      for (const style of EDGE_STYLES) {
        const { d, mid } = wirePath(10, -20, dirFromLegacy('right'), 130, 60, dirFromLegacy('up'), style)
        expect(d.length).toBeGreaterThan(0)
        expect(Number.isFinite(mid.x)).toBe(true)
        expect(Number.isFinite(mid.y)).toBe(true)
      }
    })
  })
})
