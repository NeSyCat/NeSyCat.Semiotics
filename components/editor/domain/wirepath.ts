// NeSyCat Semiotics — wire path geometry.
//
// The SINGLE source of truth for how a wire is drawn between two endpoints,
// in any of the three EdgeStyles. Both the canvas (ui/LineEdge.tsx, which
// draws the SVG path directly) and the exporters (ir/geometry-ir.ts, which
// feeds export/tikz.ts and export/html.ts) call into this module — never
// re-derive curve/elbow math anywhere else, or canvas and exports drift
// apart pixel-for-pixel.
//
// Pure, synchronous, no DOM — same testability contract as ir/geometry-ir.ts.

export type EdgeStyle = 'straight' | 'bezier' | 'smoothstep'

// The full, runtime-checkable set of valid EdgeStyles — mirrors domain/
// forms.ts's SHAPES pattern, so persist/io.ts's restoreDiagram can validate
// a loaded diagram's edgeStyle field against this instead of hand-rolling a
// second list that could drift from the type above.
export const EDGE_STYLES: readonly EdgeStyle[] = ['straight', 'bezier', 'smoothstep']

export interface Vec {
  x: number
  y: number
}

// An endpoint's outward wire-tangent direction — a TRUE unit vector (any
// angle, not just the 4 cardinals), or null for a free end (no meaningful
// single direction — e.g. a 'self' point on an 'empty' form). The real
// pipeline gets this from domain/forms.ts's worldPointNormal (the form's own
// per-shape edge/arc perpendicular, rotated by form.rotation) — see
// ui/Canvas.tsx's builtEdges and ir/geometry-ir.ts's buildLineCmds, the only
// two call sites, so canvas and exports can never disagree on a point's
// tangent. dirFromCardinal/dirFromLegacy below are adapters for callers that
// only have a coarse cardinal, not a computed geometry — production code no
// longer does (a static per-edgeKey cardinal is wrong for a slanted triangle
// edge and never accounts for form.rotation), kept for callers/tests that do.
export type Dir = Vec | null

export interface WirePathResult {
  d: string
  c1?: Vec
  c2?: Vec
  mid: Vec
}

// React Flow's Position enum spelling ('left'|'top'|'right'|'bottom') — an
// adapter for a caller that only has that coarse cardinal (not a computed
// worldPointNormal). NOT used by the real canvas/export pipeline any more
// (see Dir's own comment) — kept because it's a harmless, still-correct
// special case (an axis-aligned cardinal IS its own correct unit vector) and
// existing tests build fixtures from it.
export function dirFromCardinal(cardinal: string | null | undefined): Dir {
  switch (cardinal) {
    case 'top': return { x: 0, y: -1 }
    case 'right': return { x: 1, y: 0 }
    case 'bottom': return { x: 0, y: 1 }
    case 'left': return { x: -1, y: 0 }
    default: return null
  }
}

// The legacy 4-cardinal spelling this module's OWN Dir type used before it
// generalized to arbitrary unit vectors ('left'|'right'|'up'|'down', not
// React Flow's Position spelling above) — an adapter so call sites/tests
// written against that old spelling keep compiling: wrap a literal with
// dirFromLegacy(...) wherever a bare cardinal string used to be passed
// directly as a Dir argument.
export type LegacyCardinalDir = 'left' | 'right' | 'up' | 'down' | null
export function dirFromLegacy(cardinal: LegacyCardinalDir): Dir {
  switch (cardinal) {
    case 'left': return { x: -1, y: 0 }
    case 'right': return { x: 1, y: 0 }
    case 'up': return { x: 0, y: -1 }
    case 'down': return { x: 0, y: 1 }
    default: return null
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function fmt(n: number): string {
  // Trims float noise (e.g. 12.000000001) without rounding visible precision
  // away — paths are drawn at screen scale, not exported to a fixed grid.
  return (Math.round(n * 1000) / 1000).toString()
}

function vfmt(v: Vec): string {
  return `${fmt(v.x)} ${fmt(v.y)}`
}

// ── Straightness guard (angular, not a fixed pixel snap) ──────────────
// Both curved styles (bezier, smoothstep) fall back to a plain straight line
// when the CHORD's deviation from its own dominant axis is at most
// STRAIGHT_ANGLE_DEG — a near-axis-aligned wire drawing a "curve"/"elbow"
// for a few stray degrees reads as a visible bump/squiggle, not a real bend
// (this replaces an earlier fixed-1px snap that was too timid — a wire
// could be many px off-axis over a long run and still read as "basically
// straight"; the RIGHT measure is the angle, not the raw pixel delta).
// Recalibrated from 4° to 10°: real-world bumpy wires measured ~11-17px
// cross-delta over ~100-150px runs (≈6-10°) — still jogging under a 4°
// threshold, since those all sit ABOVE it. 10° comfortably covers that
// whole observed range while still treating a clearly-diagonal wire
// (≳12°) as a real bend, not noise.
// STRAIGHT_MIN_PX is a pixel floor so a very SHORT wire (where even the
// angle threshold's own crossDelta is just 1-2px) doesn't get a real curve
// either. Purely a function of the raw chord (sx,sy)->(tx,ty) — independent
// of either endpoint's Dir.
const STRAIGHT_ANGLE_DEG = 10
const STRAIGHT_MIN_PX = 1

export function isNearlyStraight(sx: number, sy: number, tx: number, ty: number): boolean {
  const dx = Math.abs(tx - sx)
  const dy = Math.abs(ty - sy)
  const mainDelta = Math.max(dx, dy)
  const crossDelta = Math.min(dx, dy)
  const threshold = Math.max(STRAIGHT_MIN_PX, Math.tan((STRAIGHT_ANGLE_DEG * Math.PI) / 180) * mainDelta)
  return crossDelta <= threshold
}

// ── straight ────────────────────────────────────────────────────────────
function straightPath(sx: number, sy: number, tx: number, ty: number): WirePathResult {
  return {
    d: `M ${vfmt({ x: sx, y: sy })} L ${vfmt({ x: tx, y: ty })}`,
    mid: { x: (sx + tx) / 2, y: (sy + ty) / 2 },
  }
}

// ── bezier (string-diagram look) ───────────────────────────────────────
const BEZIER_K_MIN = 24
const BEZIER_K_MAX = 220

function bezierPath(sx: number, sy: number, sDir: Dir, tx: number, ty: number, tDir: Dir): WirePathResult {
  const dx = tx - sx
  const dy = ty - sy
  const dist = Math.hypot(dx, dy) || 1
  const k = clamp(0.5 * dist, BEZIER_K_MIN, BEZIER_K_MAX)
  // A null Dir leaves along the straight line toward the OTHER endpoint —
  // source toward target (dx,dy)/dist; target toward source is the inverse.
  // A non-null Dir is used AS-IS — it's already a true (possibly diagonal)
  // unit vector, e.g. a triangle slant edge's own perpendicular, or any
  // edge's normal after the form's own rotation — no further conversion.
  const su = sDir ?? { x: dx / dist, y: dy / dist }
  const tu = tDir ?? { x: -dx / dist, y: -dy / dist }
  const c1: Vec = { x: sx + su.x * k, y: sy + su.y * k }
  const c2: Vec = { x: tx + tu.x * k, y: ty + tu.y * k }
  // Cubic Bezier point at t=0.5: B(.5) = P0/8 + 3P1/8 + 3P2/8 + P3/8.
  const mid: Vec = {
    x: 0.125 * sx + 0.375 * c1.x + 0.375 * c2.x + 0.125 * tx,
    y: 0.125 * sy + 0.375 * c1.y + 0.375 * c2.y + 0.125 * ty,
  }
  return { d: `M ${vfmt({ x: sx, y: sy })} C ${vfmt(c1)}, ${vfmt(c2)}, ${vfmt({ x: tx, y: ty })}`, c1, c2, mid }
}

// ── smoothstep (our own simple orthogonal router — NOT React Flow's) ────
const STEP_OFFSET = 24
export const STEP_RADIUS = 8

// Where the smoothstep router's ONE cross-axis turn sits along the route:
//   'mid'    — centered between the two (stub-adjusted) endpoints. Default;
//              right for an ordinary one-to-one wire.
//   'source' — the turn happens immediately after the source's own stub (or
//              exactly AT the source for a free/null-Dir end, which has no
//              stub) — every branch of a multi-target hyperedge then turns
//              at the SAME point (the shared source), so their cross-axis
//              runs fan out from there instead of coinciding into one shared
//              "trunk" that smears the split and hides the copy point.
export type ElbowPlacement = 'mid' | 'source'

// Smoothstep draws ONLY horizontal/vertical segments (that's the whole
// point of an orthogonal router) even though a Dir can now be an arbitrary
// diagonal unit vector (a rotated form's true normal) — so its stub leaves
// along whichever AXIS that vector is MORE aligned with (its dominant
// component), snapped to that axis's own unit vector, sign preserved.
// Bezier (above) uses the raw vector as-is; only smoothstep snaps it.
function stepStubUnit(dir: Dir): Vec | null {
  if (!dir) return null
  return Math.abs(dir.x) >= Math.abs(dir.y)
    ? { x: dir.x >= 0 ? 1 : -1, y: 0 }
    : { x: 0, y: dir.y >= 0 ? 1 : -1 }
}

// Horizontal elbow (turn on a mid-X vertical) when the source's Dir is MORE
// horizontal than vertical (dominant component), or (source Dir null) when
// the raw endpoints are horizontally dominant; vertical elbow (mid-Y)
// otherwise. Shared by smoothstepElbowPoints, smoothstepMid, and
// stepStubUnit's own axis choice — the ONE place this axis is decided, so
// none of them can ever disagree.
function elbowAxisHorizontal(sDir: Dir, sx: number, sy: number, tx: number, ty: number): boolean {
  if (sDir) return Math.abs(sDir.x) >= Math.abs(sDir.y)
  return Math.abs(tx - sx) >= Math.abs(ty - sy)
}

// The two corner points of the router's ONE cross-axis segment, per
// ElbowPlacement — the SAME computation smoothstepElbowPoints and
// smoothstepMid both need, so they can never disagree on where the turn is.
// 'mid': centered — corner1/corner2 straddle the shared mid-X (horizontal
// primary axis) or mid-Y (vertical) line, each level with its OWN stub.
// 'source': corner1 IS s1 itself (the turn starts right where the source's
// stub ends, or at the source itself when there's no stub) — corner2 is s1
// carried onto the target's row/column, so the ENTIRE cross-axis run happens
// immediately after the source, before anything target-specific.
function elbowCorners(s1: Vec, t1: Vec, horizontal: boolean, elbow: ElbowPlacement): [Vec, Vec] {
  if (elbow === 'source') {
    return [s1, horizontal ? { x: s1.x, y: t1.y } : { x: t1.x, y: s1.y }]
  }
  if (horizontal) {
    const midX = (s1.x + t1.x) / 2
    return [{ x: midX, y: s1.y }, { x: midX, y: t1.y }]
  }
  const midY = (s1.y + t1.y) / 2
  return [{ x: s1.x, y: midY }, { x: t1.x, y: midY }]
}

// The raw (pre-rounded) elbow route: S -> [S1] -> corner1 -> corner2 -> [T1]
// -> T, deduped of consecutive coincident points. S1/T1 are the outward-
// offset "leave/arrive" stubs (skipped when that endpoint's Dir is null);
// corner1/corner2 are the ONE cross-axis segment's own endpoints, placed per
// `elbow` (see elbowCorners). Exported so export/tikz.ts can draw the SAME
// route as a native `--`-segment polyline (with `rounded corners=`) instead
// of parsing the SVG `d` string this module also builds for the canvas/
// HTML-SVG path.
export function smoothstepElbowPoints(
  sx: number, sy: number, sDir: Dir, tx: number, ty: number, tDir: Dir, elbow: ElbowPlacement = 'mid',
): Vec[] {
  const sv = stepStubUnit(sDir)
  const tv = stepStubUnit(tDir)
  const s1: Vec = sv ? { x: sx + sv.x * STEP_OFFSET, y: sy + sv.y * STEP_OFFSET } : { x: sx, y: sy }
  const t1: Vec = tv ? { x: tx + tv.x * STEP_OFFSET, y: ty + tv.y * STEP_OFFSET } : { x: tx, y: ty }
  const horizontal = elbowAxisHorizontal(sDir, sx, sy, tx, ty)
  const [corner1, corner2] = elbowCorners(s1, t1, horizontal, elbow)
  const raw: Vec[] = [{ x: sx, y: sy }]
  if (sv) raw.push(s1)
  raw.push(corner1, corner2)
  if (tv) raw.push(t1)
  raw.push({ x: tx, y: ty })
  const pts: Vec[] = []
  for (const p of raw) {
    const last = pts[pts.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) pts.push(p)
  }
  return pts
}

// The cross-axis segment's own midpoint — the label anchor for a smoothstep
// wire (wherever that segment sits along the route, per `elbow`).
// Independent of rounding (rounding only trims the polyline's corners
// inward within each segment's own span).
function smoothstepMid(sx: number, sy: number, sDir: Dir, tx: number, ty: number, tDir: Dir, elbow: ElbowPlacement): Vec {
  const sv = stepStubUnit(sDir)
  const tv = stepStubUnit(tDir)
  const s1: Vec = sv ? { x: sx + sv.x * STEP_OFFSET, y: sy + sv.y * STEP_OFFSET } : { x: sx, y: sy }
  const t1: Vec = tv ? { x: tx + tv.x * STEP_OFFSET, y: ty + tv.y * STEP_OFFSET } : { x: tx, y: ty }
  const horizontal = elbowAxisHorizontal(sDir, sx, sy, tx, ty)
  const [corner1, corner2] = elbowCorners(s1, t1, horizontal, elbow)
  return { x: (corner1.x + corner2.x) / 2, y: (corner1.y + corner2.y) / 2 }
}

// Turns an ordered point list into an SVG path string, rounding every
// interior corner with a quarter-circle arc of radius `min(STEP_RADIUS, half
// of each adjacent segment)` — so a short stub/segment never overshoots into
// its neighbour. Degenerate (near-zero) corners fall back to a plain `L`.
function roundedPolylinePath(pts: Vec[]): string {
  if (pts.length < 2) return pts.length === 1 ? `M ${vfmt(pts[0])}` : ''
  if (pts.length === 2) return `M ${vfmt(pts[0])} L ${vfmt(pts[1])}`
  let d = `M ${vfmt(pts[0])}`
  for (let i = 1; i < pts.length - 1; i++) {
    const prev = pts[i - 1]
    const corner = pts[i]
    const next = pts[i + 1]
    const segIn = Math.hypot(corner.x - prev.x, corner.y - prev.y)
    const segOut = Math.hypot(next.x - corner.x, next.y - corner.y)
    const r = Math.min(STEP_RADIUS, segIn / 2, segOut / 2)
    if (r < 1e-6) {
      d += ` L ${vfmt(corner)}`
      continue
    }
    const inX = (corner.x - prev.x) / segIn
    const inY = (corner.y - prev.y) / segIn
    const outX = (next.x - corner.x) / segOut
    const outY = (next.y - corner.y) / segOut
    const a: Vec = { x: corner.x - inX * r, y: corner.y - inY * r }
    const b: Vec = { x: corner.x + outX * r, y: corner.y + outY * r }
    // Axis-aligned 90° turns only: cross(in, out) is always ±1 here — its
    // sign picks the arc's sweep direction (SVG's y-down sweep-flag=1 turn).
    const cross = inX * outY - inY * outX
    const sweep = cross > 0 ? 1 : 0
    d += ` L ${vfmt(a)} A ${fmt(r)} ${fmt(r)} 0 0 ${sweep} ${vfmt(b)}`
  }
  d += ` L ${vfmt(pts[pts.length - 1])}`
  return d
}

function smoothstepPath(sx: number, sy: number, sDir: Dir, tx: number, ty: number, tDir: Dir, elbow: ElbowPlacement): WirePathResult {
  const pts = smoothstepElbowPoints(sx, sy, sDir, tx, ty, tDir, elbow)
  return { d: roundedPolylinePath(pts), mid: smoothstepMid(sx, sy, sDir, tx, ty, tDir, elbow) }
}

// ── Entry point ───────────────────────────────────────────────────────
export function wirePath(
  sx: number, sy: number, sDir: Dir,
  tx: number, ty: number, tDir: Dir,
  style: EdgeStyle,
  // Only meaningful for 'smoothstep' — see ElbowPlacement above. Ignored for
  // 'bezier'/'straight', which have no elbow to place.
  elbow: ElbowPlacement = 'mid',
): WirePathResult {
  if (style === 'straight') return straightPath(sx, sy, tx, ty)
  // The angular straightness guard applies to BOTH curved styles, ahead of
  // their own Dir-driven geometry — see isNearlyStraight's own comment.
  if (isNearlyStraight(sx, sy, tx, ty)) return straightPath(sx, sy, tx, ty)
  if (style === 'bezier') return bezierPath(sx, sy, sDir, tx, ty, tDir)
  return smoothstepPath(sx, sy, sDir, tx, ty, tDir, elbow)
}
