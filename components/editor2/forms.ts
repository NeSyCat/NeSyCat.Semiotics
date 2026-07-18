import { Position } from '@xyflow/react'
import type { Form, FormKind, EdgeKey } from './types'

// ── Layout constants ─────────────────────────────────────────────────
export const BASE_SIZE = 200
export const ROW_HEIGHT = 48
export const POINT_DOT = 12
// How close (in [0,1] form-fraction space) a double-click must be to a vertex
// to add a CORNER point rather than an edge point.
const CORNER_R = 0.16

export interface Anchor {
  x: number
  y: number
  position: Position
}

// Hover/selection overlay shape for a point-creation region (an edgeKey), in
// form-fraction [0,1]² space — FormNode scales by node size and strokes/fills
// it with a gray tint. 'polyline' covers both straight sides (2 points) and
// circle arcs (sampled points) with one rendering path; 'corner' is a small
// dot at a vertex; 'full' is the whole body (point/empty's single self-region).
export type RegionShape =
  | { kind: 'polyline'; points: ReadonlyArray<readonly [number, number]> }
  | { kind: 'corner'; at: readonly [number, number] }
  | { kind: 'full' }

export type Body =
  | { type: 'polygon'; pointsFrac: ReadonlyArray<readonly [number, number]> }
  | { type: 'circle' }
  | { type: 'dot' } // a solid filled dot, no outline — the string-diagram "point"

export interface FormGeometry {
  kind: FormKind
  displayName: string
  // Side keys + corner keys. A point sits on one of these (edge or vertex).
  edgeKeys: readonly EdgeKey[]
  // Which of edgeKeys are vertices, mapped to their position in form-fractions.
  corners: Readonly<Record<EdgeKey, readonly [number, number]>>
  body: Body
  bodyOpacity: number
  // Whether the form's own name renders on the canvas — off for kinds that
  // carry no identity of their own (a functional/anonymous node).
  showName: boolean
  // Whether this kind carves a separate inner "select the whole form" zone
  // out of its body — off for point/empty, which are too small (and whose
  // whole body is already one shared point-creation region) to usefully
  // split into a ring + center.
  hasCenterZone: boolean
  nodeSize: (form: Form) => number
  pointAnchor: (edgeKey: EdgeKey, index: number, count: number, n: number) => Anchor
  // Nearest edge/corner to a normalized cursor (rx, ry) ∈ [0,1]².
  edgeAt: (rx: number, ry: number) => EdgeKey | undefined
  // Overlay shape for hovering/selecting this edgeKey's region.
  regionShape: (edgeKey: EdgeKey) => RegionShape
  // Hard per-edge attachment cap this kind declares, so capacity lives here
  // (geometry) instead of scattered "if kind === 'empty'" checks through
  // mutations/Canvas. undefined = unbounded (every kind but 'empty'). When a
  // side is at capacity, mutations.addPoint REUSES its existing point rather
  // than refusing — unlike a corner's hard '' no-op, a drop on a full side
  // should still CONNECT (many wires, one point).
  maxPoints?: number
  // The INVERSE of pointAnchor's own spacing formula for a SIDE edgeKey: given
  // a normalized cursor (rx, ry) ∈ [0,1]² already known to be on/near this
  // edge, returns the same t ∈ [0,1] ordering parameter pointAnchor's t
  // (whatever its per-kind meaning — linear position along a side, or angle
  // around an arc/fan) would have produced for a point sitting there. Single
  // source of truth for "where along this edge did the gesture happen" —
  // insertionIndex below is the only consumer. Undefined for corner keys
  // (a corner is a single slot; ordering is meaningless there).
  edgeParam: (edgeKey: EdgeKey, rx: number, ry: number) => number
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

// Where a NEW point's gesture (rx, ry) should land in an edge's existing
// ordered point list — the fix for "wires cross instead of running parallel"
// when two points get created on facing sides in the wrong relative order.
// Generic across every kind: for each of the `count` existing points, re-
// derive ITS OWN t (by asking pointAnchor where it currently sits, then
// inverting that back through edgeParam) and count how many precede the
// gesture's own t. Because edgeParam is the exact inverse of whatever
// spacing formula pointAnchor used to place that point, this stays correct
// for linear sides (t = (i+1)/(count+1)), circle arcs (t = angle fraction),
// and the point/empty radial fan (t = i/count) without needing a separate
// closed-form per kind. Corner keys have no ordering — 0 is a harmless,
// ignored default (mutations.addPoint never splices a corner).
export function insertionIndex(form: Form, edgeKey: EdgeKey, rx: number, ry: number): number {
  const geom = geometryFor(form.kind)
  if (edgeKey in geom.corners) return 0
  const ids = form.edges[edgeKey] ?? []
  const count = ids.length
  if (count === 0) return 0
  const tg = geom.edgeParam(edgeKey, rx, ry)
  let k = 0
  for (let i = 0; i < count; i++) {
    // n=1: every non-corner pointAnchor formula is linear in n, so fractions
    // come out the same regardless of the actual node size.
    const a = geom.pointAnchor(edgeKey, i, count, 1)
    const ti = geom.edgeParam(edgeKey, a.x, a.y)
    if (ti < tg) k++
  }
  return Math.min(count, k)
}

// ── Shared helpers ───────────────────────────────────────────────────
// The point id(s) at an edge key — a side's ordered list as-is, or a corner's
// single optional slot wrapped as a 0-or-1 list. Single source of "what's
// here" for rendering/lookup code that doesn't need to care which it is.
export function pointIdsAt(form: Form, edgeKey: EdgeKey): string[] {
  if (edgeKey in geometryFor(form.kind).corners) {
    const pid = form.corners[edgeKey]
    return pid ? [pid] : []
  }
  return form.edges[edgeKey] ?? []
}

function maxPointsOnAnyEdge(form: Form, edgeKeys: readonly EdgeKey[]): number {
  let m = 0
  for (const k of edgeKeys) {
    const len = pointIdsAt(form, k).length
    if (len > m) m = len
  }
  return m
}
const sizeFor = (edgeKeys: readonly EdgeKey[]) => (form: Form) =>
  Math.max(BASE_SIZE, (maxPointsOnAnyEdge(form, edgeKeys) + 1) * ROW_HEIGHT)

function distToSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

// Whether a normalized cursor (rx, ry) ∈ [0,1]² sits inside the form's own
// visible body — the split between the point-creation region hover (inside)
// and an existing point's drag-region hover (outside): a point's own anchor
// sits ON the boundary, so this decides which highlight wins when both are
// geometrically nearby. Ray-casting point-in-polygon for straight-sided
// bodies; a simple radius test for circle/dot.
export function isInsideBody(body: Body, rx: number, ry: number): boolean {
  if (body.type === 'circle' || body.type === 'dot') {
    return Math.hypot(rx - 0.5, ry - 0.5) <= 0.5
  }
  const pts = body.pointsFrac
  let inside = false
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i]
    const [xj, yj] = pts[j]
    if (yi > ry !== yj > ry && rx < ((xj - xi) * (ry - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// How far a form's inner "select the whole form" zone is shrunk toward its
// centre (0.5, 0.5), relative to the true body — leaving an outer ring for
// the point-creation edge/corner regions. Hit-test only: hovering the zone
// highlights the form's WHOLE body (FormNode renders that separately), this
// constant only decides where the zone's own boundary sits.
export const CENTER_SHRINK = 0.55

// Whether (rx, ry) sits inside a `shrink`-scaled copy of the body, centred at
// (0.5, 0.5) — scale the query point OUTWARD from centre and test it against
// the TRUE (unshrunk) body, which is equivalent to testing it against a
// shrunk copy without needing a second isInsideBody implementation.
export function isInCenterZone(body: Body, rx: number, ry: number, shrink: number = CENTER_SHRINK): boolean {
  return isInsideBody(body, 0.5 + (rx - 0.5) / shrink, 0.5 + (ry - 0.5) / shrink)
}

// The shrunk body's own outline — for the invisible drag-handle hit-area
// FormNode renders over the center zone (React Flow's dragHandle prop can
// only target a real, always-present element, so it needs actual geometry
// here, separate from the center-hover VISUAL which highlights the whole
// body). null for circle/dot bodies — FormNode draws those as a plain
// scaled circle instead.
export function shrunkBodyPoints(body: Body, shrink: number = CENTER_SHRINK): ReadonlyArray<readonly [number, number]> | null {
  if (body.type !== 'polygon') return null
  return body.pointsFrac.map(([x, y]) => [0.5 + (x - 0.5) * shrink, 0.5 + (y - 0.5) * shrink] as const)
}

// Inset a straight edge's endpoints toward its midpoint by `inset` (fraction
// units) — keeps a side's hover stripe from overlapping the corner regions at
// either end. `inset` is capped at half the segment length so short edges
// (e.g. a rhombus's diagonal sides) never invert into a negative-length stripe.
function insetSegment(
  a: readonly [number, number], b: readonly [number, number], inset: number,
): [[number, number], [number, number]] {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const t = Math.min(inset, len / 2)
  const ux = dx / len, uy = dy / len
  return [[a[0] + ux * t, a[1] + uy * t], [b[0] - ux * t, b[1] - uy * t]]
}

// A point pinned at a vertex; stacks outward (away from centre) when several
// share the corner.
function cornerAnchor(vf: readonly [number, number], index: number, n: number): Anchor {
  const dx = vf[0] - 0.5
  const dy = vf[1] - 0.5
  const len = Math.hypot(dx, dy) || 1
  const nx = dx / len
  const ny = dy / len
  const off = index * 13
  const x = vf[0] * n + nx * off
  const y = vf[1] * n + ny * off
  const position = Math.abs(nx) >= Math.abs(ny)
    ? (nx >= 0 ? Position.Right : Position.Left)
    : (ny >= 0 ? Position.Bottom : Position.Top)
  return { x, y, position }
}

function nearestCorner(rx: number, ry: number, corners: Readonly<Record<EdgeKey, readonly [number, number]>>): { key: EdgeKey; dist: number } | undefined {
  let best: { key: EdgeKey; dist: number } | undefined
  for (const k of Object.keys(corners)) {
    const [vx, vy] = corners[k]
    const d = Math.hypot(rx - vx, ry - vy)
    if (!best || d < best.dist) best = { key: k, dist: d }
  }
  return best
}

function cardinal(theta: number): Position {
  if (theta > Math.PI / 4 && theta <= (3 * Math.PI) / 4) return Position.Top
  if (theta > -Math.PI / 4 && theta <= Math.PI / 4) return Position.Right
  if (theta > -(3 * Math.PI) / 4 && theta <= -Math.PI / 4) return Position.Bottom
  return Position.Left
}

// Evenly spaced around a shared point's own circumference — used by kinds
// whose whole body is one attachment (point, empty), where ANY spot on the
// body resolves to the same edge and multiple points fan out around it
// rather than sitting on named sides.
function radialFanAnchor(index: number, count: number, n: number): Anchor {
  const raw = (index / count) * 2 * Math.PI
  const theta = raw > Math.PI ? raw - 2 * Math.PI : raw
  const r = n / 2
  return { x: n / 2 + r * Math.cos(theta), y: n / 2 - r * Math.sin(theta), position: cardinal(theta) }
}

// Inverse of radialFanAnchor's own raw→θ fold (θ = raw > π ? raw − 2π : raw,
// raw ∈ [0, 2π)): recover θ from a normalized cursor, then undo the fold —
// θ < 0 came from a raw past π, so add 2π back.
function radialFanParam(rx: number, ry: number): number {
  const theta = angleFromFraction(rx, ry)
  const raw = theta < 0 ? theta + 2 * Math.PI : theta
  return clamp01(raw / (2 * Math.PI))
}

// ── TRIANGLE — apex points RIGHT (the standard orientation). Sides:
//   a = top slant (top-left → apex), b = bottom slant (bottom-left → apex),
//   c = left side (top-left → bottom-left, vertical).
//   Corners v0 = apex (right), v1 = bottom-left, v2 = top-left.
const SQRT3_4 = Math.sqrt(3) / 4
const TRI_APEX_X = 0.5 + SQRT3_4 // ≈ 0.933 (rightmost point)
const TRI_BASE_X = 0.5 - SQRT3_4 // ≈ 0.067 (the left, vertical base)
const TRI_CORNERS = { v0: [TRI_APEX_X, 0.5], v1: [TRI_BASE_X, 1], v2: [TRI_BASE_X, 0] } as const
const TRI_EDGES = ['a', 'b', 'c', 'v0', 'v1', 'v2'] as const

// A point along slant 'a' (from the top-left base vertex) or 'b' (bottom-left),
// running to the apex on the right.
function triSlant(side: 'a' | 'b', t: number, n: number): [number, number] {
  const by = (side === 'a' ? 0 : 1) * n
  const bx = TRI_BASE_X * n
  return [bx + (TRI_APEX_X * n - bx) * t, by + (0.5 * n - by) * t]
}

const triangleGeometry: FormGeometry = {
  kind: 'triangle',
  displayName: 'Triangle',
  edgeKeys: TRI_EDGES,
  corners: TRI_CORNERS,
  body: { type: 'polygon', pointsFrac: [[TRI_APEX_X, 0.5], [TRI_BASE_X, 1], [TRI_BASE_X, 0]] },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: sizeFor(TRI_EDGES),
  pointAnchor: (edgeKey, index, count, n) => {
    if (edgeKey in TRI_CORNERS) return cornerAnchor(TRI_CORNERS[edgeKey as keyof typeof TRI_CORNERS], index, n)
    const t = (index + 1) / (count + 1)
    if (edgeKey === 'a') { const [x, y] = triSlant('a', t, n); return { x, y, position: Position.Top } }
    if (edgeKey === 'b') { const [x, y] = triSlant('b', t, n); return { x, y, position: Position.Bottom } }
    return { x: TRI_BASE_X * n, y: t * n, position: Position.Left } // c = left vertical side
  },
  edgeAt: (rx, ry) => {
    const nc = nearestCorner(rx, ry, TRI_CORNERS)
    if (nc && nc.dist < CORNER_R) return nc.key
    const da = distToSeg(rx, ry, TRI_BASE_X, 0, TRI_APEX_X, 0.5) // a = top slant
    const db = distToSeg(rx, ry, TRI_BASE_X, 1, TRI_APEX_X, 0.5) // b = bottom slant
    const dc = distToSeg(rx, ry, TRI_BASE_X, 0, TRI_BASE_X, 1) // c = left side
    if (da <= db && da <= dc) return 'a'
    if (db <= dc) return 'b'
    return 'c'
  },
  regionShape: (edgeKey) => {
    if (edgeKey in TRI_CORNERS) return { kind: 'corner', at: TRI_CORNERS[edgeKey as keyof typeof TRI_CORNERS] }
    if (edgeKey === 'a') return { kind: 'polyline', points: insetSegment([TRI_BASE_X, 0], [TRI_APEX_X, 0.5], CORNER_R) }
    if (edgeKey === 'b') return { kind: 'polyline', points: insetSegment([TRI_BASE_X, 1], [TRI_APEX_X, 0.5], CORNER_R) }
    return { kind: 'polyline', points: insetSegment([TRI_BASE_X, 0], [TRI_BASE_X, 1], CORNER_R) } // c
  },
  // Inverse of triSlant's t (y runs 0→0.5 for 'a', 1→0.5 for 'b') / the
  // direct t=y assignment for 'c' (see pointAnchor above).
  edgeParam: (edgeKey, _rx, ry) => {
    if (edgeKey === 'a') return clamp01(2 * ry)
    if (edgeKey === 'b') return clamp01(2 * (1 - ry))
    return clamp01(ry) // c
  },
}

// ── SQUARE (4 sides + 4 corners) ─────────────────────────────────────
const SQ_CORNERS = { v0: [0, 0], v1: [1, 0], v2: [1, 1], v3: [0, 1] } as const
const SQUARE_EDGES = ['top', 'right', 'bottom', 'left', 'v0', 'v1', 'v2', 'v3'] as const

const squareGeometry: FormGeometry = {
  kind: 'square',
  displayName: 'Square',
  edgeKeys: SQUARE_EDGES,
  corners: SQ_CORNERS,
  body: { type: 'polygon', pointsFrac: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: sizeFor(SQUARE_EDGES),
  pointAnchor: (edgeKey, index, count, n) => {
    if (edgeKey in SQ_CORNERS) return cornerAnchor(SQ_CORNERS[edgeKey as keyof typeof SQ_CORNERS], index, n)
    const t = (index + 1) / (count + 1)
    switch (edgeKey) {
      case 'top': return { x: t * n, y: 0, position: Position.Top }
      case 'right': return { x: n, y: t * n, position: Position.Right }
      case 'bottom': return { x: t * n, y: n, position: Position.Bottom }
      default: return { x: 0, y: t * n, position: Position.Left }
    }
  },
  edgeAt: (rx, ry) => {
    const nc = nearestCorner(rx, ry, SQ_CORNERS)
    if (nc && nc.dist < CORNER_R) return nc.key
    const d = { top: ry, right: 1 - rx, bottom: 1 - ry, left: rx }
    return (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => (d[b] < d[a] ? b : a))
  },
  regionShape: (edgeKey) => {
    if (edgeKey in SQ_CORNERS) return { kind: 'corner', at: SQ_CORNERS[edgeKey as keyof typeof SQ_CORNERS] }
    switch (edgeKey) {
      case 'top': return { kind: 'polyline', points: insetSegment([0, 0], [1, 0], CORNER_R) }
      case 'right': return { kind: 'polyline', points: insetSegment([1, 0], [1, 1], CORNER_R) }
      case 'bottom': return { kind: 'polyline', points: insetSegment([0, 1], [1, 1], CORNER_R) }
      default: return { kind: 'polyline', points: insetSegment([0, 0], [0, 1], CORNER_R) } // left
    }
  },
  // Inverse of pointAnchor's t*n assignment: top/bottom run along x, left/
  // right run along y (see pointAnchor above).
  edgeParam: (edgeKey, rx, ry) => {
    switch (edgeKey) {
      case 'top': case 'bottom': return clamp01(rx)
      default: return clamp01(ry) // left/right
    }
  },
}

// ── CIRCLE (4 cardinal arcs up/right/down/left; no vertices) ─────────
// Each arc spans 90° centred on a cardinal direction, with boundaries at the
// diagonals: 'up' = the top quarter (NW→N→NE), etc.
const CIRCLE_EDGES = ['up', 'right', 'down', 'left'] as const
const ARC_START: Record<string, number> = {
  up: (3 * Math.PI) / 4, right: Math.PI / 4, down: -Math.PI / 4, left: -(3 * Math.PI) / 4,
}
const ARC_POSITION: Record<string, Position> = { up: Position.Top, right: Position.Right, down: Position.Bottom, left: Position.Left }
function arcPt(edgeKey: string, t: number, n: number): [number, number] {
  const r = n / 2
  const theta = ARC_START[edgeKey] - t * (Math.PI / 2)
  return [n / 2 + r * Math.cos(theta), n / 2 - r * Math.sin(theta)]
}

// Inverse of arcPt's own x/y assignment (x = n/2 + r·cosθ, y = n/2 − r·sinθ,
// centred at fraction (0.5, 0.5)) — recovers θ from a normalized cursor,
// shared by the circle arcs' and the radial fan's edgeParam.
function angleFromFraction(rx: number, ry: number): number {
  return Math.atan2(-(ry - 0.5), rx - 0.5)
}

// Same trig as arcPt but sampled across the whole 90° quadrant, in
// form-fraction space, for drawing a stroked arc region overlay.
const ARC_REGION_SAMPLES = 10
function arcRegionPoints(edgeKey: string): Array<[number, number]> {
  return Array.from({ length: ARC_REGION_SAMPLES + 1 }, (_, i) => {
    const t = i / ARC_REGION_SAMPLES
    const theta = ARC_START[edgeKey] - t * (Math.PI / 2)
    return [0.5 + 0.5 * Math.cos(theta), 0.5 - 0.5 * Math.sin(theta)]
  })
}

const circleGeometry: FormGeometry = {
  kind: 'circle',
  displayName: 'Circle',
  edgeKeys: CIRCLE_EDGES,
  corners: {},
  body: { type: 'circle' },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: sizeFor(CIRCLE_EDGES),
  pointAnchor: (edgeKey, index, count, n) => {
    const t = (index + 1) / (count + 1)
    const [x, y] = arcPt(edgeKey, t, n)
    return { x, y, position: ARC_POSITION[edgeKey] }
  },
  edgeAt: (rx, ry) => {
    const ang = Math.atan2(-(ry - 0.5), rx - 0.5)
    if (ang > Math.PI / 4 && ang <= (3 * Math.PI) / 4) return 'up'
    if (ang > -Math.PI / 4 && ang <= Math.PI / 4) return 'right'
    if (ang > -(3 * Math.PI) / 4 && ang <= -Math.PI / 4) return 'down'
    return 'left'
  },
  regionShape: (edgeKey) => ({ kind: 'polyline', points: arcRegionPoints(edgeKey) }),
  // Inverse of arcPt's θ = ARC_START[edgeKey] − t·(π/2): recover θ, then
  // undo that subtraction — normalized into [0, 2π) first since 'left'
  // wraps across the ±π seam (ARC_START.left = −3π/4, so its far end lands
  // past π).
  edgeParam: (edgeKey, rx, ry) => {
    const theta = angleFromFraction(rx, ry)
    const raw = ARC_START[edgeKey] - theta
    const norm = ((raw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    return clamp01(norm / (Math.PI / 2))
  },
}

// ── RHOMBUS (diamond orientation — 4 sides + 4 corners, same shape as
//   SQUARE just named for diagonal sides). v0 = top, v1 = right, v2 = bottom,
//   v3 = left. Sides run clockwise between adjacent corners.
const RHOMBUS_CORNERS = { v0: [0.5, 0], v1: [1, 0.5], v2: [0.5, 1], v3: [0, 0.5] } as const
const RHOMBUS_EDGES = ['top-right', 'bottom-right', 'bottom-left', 'top-left', 'v0', 'v1', 'v2', 'v3'] as const
const RHOMBUS_SIDES: Record<string, { a: readonly [number, number]; b: readonly [number, number]; position: Position }> = {
  'top-right': { a: RHOMBUS_CORNERS.v0, b: RHOMBUS_CORNERS.v1, position: Position.Top },
  'bottom-right': { a: RHOMBUS_CORNERS.v1, b: RHOMBUS_CORNERS.v2, position: Position.Bottom },
  'bottom-left': { a: RHOMBUS_CORNERS.v2, b: RHOMBUS_CORNERS.v3, position: Position.Bottom },
  'top-left': { a: RHOMBUS_CORNERS.v3, b: RHOMBUS_CORNERS.v0, position: Position.Top },
}
const lerp = (a: readonly [number, number], b: readonly [number, number], t: number): [number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

const rhombusGeometry: FormGeometry = {
  kind: 'rhombus',
  displayName: 'Rhombus',
  edgeKeys: RHOMBUS_EDGES,
  corners: RHOMBUS_CORNERS,
  body: { type: 'polygon', pointsFrac: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: sizeFor(RHOMBUS_EDGES),
  pointAnchor: (edgeKey, index, count, n) => {
    if (edgeKey in RHOMBUS_CORNERS) return cornerAnchor(RHOMBUS_CORNERS[edgeKey as keyof typeof RHOMBUS_CORNERS], index, n)
    const side = RHOMBUS_SIDES[edgeKey]
    const t = (index + 1) / (count + 1)
    const [x, y] = lerp(side.a, side.b, t)
    return { x: x * n, y: y * n, position: side.position }
  },
  edgeAt: (rx, ry) => {
    const nc = nearestCorner(rx, ry, RHOMBUS_CORNERS)
    if (nc && nc.dist < CORNER_R) return nc.key
    let best: EdgeKey = 'top-right'
    let bestDist = Infinity
    for (const key of Object.keys(RHOMBUS_SIDES)) {
      const { a, b } = RHOMBUS_SIDES[key]
      const d = distToSeg(rx, ry, a[0], a[1], b[0], b[1])
      if (d < bestDist) { bestDist = d; best = key }
    }
    return best
  },
  regionShape: (edgeKey) => {
    if (edgeKey in RHOMBUS_CORNERS) return { kind: 'corner', at: RHOMBUS_CORNERS[edgeKey as keyof typeof RHOMBUS_CORNERS] }
    const side = RHOMBUS_SIDES[edgeKey]
    return { kind: 'polyline', points: insetSegment(side.a, side.b, CORNER_R) }
  },
  // Inverse of lerp(side.a, side.b, t): project (rx, ry) onto the side's own
  // segment (same a→b direction pointAnchor's lerp used) and clamp — the
  // general projection formula, since rhombus sides aren't axis-aligned.
  edgeParam: (edgeKey, rx, ry) => {
    const side = RHOMBUS_SIDES[edgeKey]
    if (!side) return 0
    const { a, b } = side
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const len2 = dx * dx + dy * dy || 1
    const t = ((rx - a[0]) * dx + (ry - a[1]) * dy) / len2
    return clamp01(t)
  },
}

// ── POINT — a standalone atomic form: the string-diagram "copy" node. It's a
// pure, anonymous, functional thing (no name shown — it still has an id
// underneath for bookkeeping, just nothing rendered). Its single 'self' edge
// takes an unbounded list of points, fanned evenly around the dot's own
// circumference (unlike other kinds, ANY spot on the body resolves to the
// same edge — the whole point is one shared attachment, so every wire
// touching it is a copy of the same value).
const POINT_EDGE = 'self'
const POINT_SIZE = 22
// Past 4 attached points, grow the dot a little so the fan doesn't crowd.
const FAN_CROWD_THRESHOLD = 4
const FAN_GROWTH_PER_POINT = 5

const pointGeometry: FormGeometry = {
  kind: 'point',
  displayName: 'Point',
  edgeKeys: [POINT_EDGE],
  corners: {},
  body: { type: 'dot' },
  bodyOpacity: 1,
  showName: false,
  hasCenterZone: false,
  nodeSize: (form) => {
    const count = form.edges[POINT_EDGE]?.length ?? 0
    return POINT_SIZE + Math.max(0, count - FAN_CROWD_THRESHOLD) * FAN_GROWTH_PER_POINT
  },
  pointAnchor: (_edgeKey, index, count, n) => radialFanAnchor(index, count, n),
  edgeAt: () => POINT_EDGE,
  regionShape: () => ({ kind: 'full' }),
  edgeParam: (_edgeKey, rx, ry) => radialFanParam(rx, ry),
}

// ── EMPTY — an invisible carrier form (bodyOpacity 0, no name of its own).
// Deliberately the simplest kind: unlike POINT's unbounded radial fan, EMPTY
// holds AT MOST ONE point — the middle point IS the form, always rendered
// dead-center regardless of how many wires run to it (many lines, one
// point; see mutations.addPoint's maxPoints reuse). A wire dragged out into
// empty canvas space auto-creates one of these to land on (see Canvas.tsx's
// onConnectEnd); dropping on an existing one reuses its point instead of
// fanning a second one out beside it.
const EMPTY_EDGE = 'self'
const EMPTY_MAX_POINTS = 1

const emptyGeometry: FormGeometry = {
  kind: 'empty',
  displayName: 'Empty',
  edgeKeys: [EMPTY_EDGE],
  corners: {},
  body: { type: 'circle' },
  bodyOpacity: 0,
  showName: false,
  hasCenterZone: false,
  maxPoints: EMPTY_MAX_POINTS,
  nodeSize: () => BASE_SIZE / 2,
  // Constant center, regardless of index/count — there's no fan to place:
  // the one middle point always sits at the form's own centre. Position
  // 'bottom' so its name (if any) renders centred BENEATH the dot, like an
  // ordinary point's outward label placement.
  pointAnchor: (_edgeKey, _index, _count, n) => ({ x: n / 2, y: n / 2, position: Position.Bottom }),
  edgeAt: () => EMPTY_EDGE,
  regionShape: () => ({ kind: 'full' }),
  // No ordering exists — there's only ever one point — so the constant 0 is
  // the trivial (and only) valid inverse of pointAnchor's own constant.
  edgeParam: () => 0,
}

// ── Registry ─────────────────────────────────────────────────────────
export const formRegistry: Record<FormKind, FormGeometry> = {
  triangle: triangleGeometry,
  square: squareGeometry,
  circle: circleGeometry,
  rhombus: rhombusGeometry,
  point: pointGeometry,
  empty: emptyGeometry,
}

export function geometryFor(kind: FormKind): FormGeometry {
  return formRegistry[kind]
}
