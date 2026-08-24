import { Position } from '@xyflow/react'
import type { Form, Shape, EdgeKey } from './types'
import type { Vec } from './wirepath'

// ── Layout constants ─────────────────────────────────────────────────
export const BASE_SIZE = 200
export const POINT_DOT = 12
// Inset amount (in [0,1] form-fraction space) for a side's hover-stripe
// region, so two adjacent sides' stripes don't visually overlap at the
// vertex they share — purely a rendering nicety now that corners are no
// longer their own addressable region.
const CORNER_R = 0.16

export interface Anchor {
  x: number
  y: number
  position: Position
}

// Hover/selection overlay shape for a point-creation region (an edgeKey), in
// form-fraction [0,1]² space — FormNode scales by node size and strokes/fills
// it with a gray tint. 'polyline' covers both straight sides (2 points) and
// circle arcs (sampled points) with one rendering path; 'full' is the whole
// body (empty's single self-region); 'spot' is a small circular target at a
// single form-fraction point — a single-slot vertex attachment region (e.g.
// triangle's peak), as opposed to a whole side/arc.
export type RegionShape =
  | { kind: 'polyline'; points: ReadonlyArray<readonly [number, number]> }
  | { kind: 'full' }
  | { kind: 'spot'; at: readonly [number, number] }

// A point glyph's rendered OUTER diameter (border stroke included, straddle
// and all — see ui/ShapeBody.tsx, which insets the drawn path by strokeWidth
// so the painted shape's outer edge lands exactly on this number) — ALSO the
// drag-grab pad's and the hover/selection tint circle's diameter, ALSO the
// FormNode.tsx's edge point-creation region's visual stripe breadth
// (RegionOverlay's polyline strokeWidth), so a glyph sitting on that stripe
// fits flush inside it rather than overflowing past its edges. One number,
// five places it must coincide: glyph outline, grab pad, hover/selection
// tint circle, edge-region stripe breadth, and (via BODY_GAP_R in
// FormNode.tsx) the radius a form's own border/wires gap around a resident
// point's glyph. Lives here (domain), not ui/, because the export IR
// (ir/geometry-ir.ts) sits BELOW ui/ in the layer rule and can't import from
// it — this is the one place both ui/ and ir/ can reach. Also the radius
// used to gap a form's border/wires around a resident point's glyph, on
// canvas and in both export backends.
export const POINT_SIZE = 26

export type Body =
  | { type: 'polygon'; pointsFrac: ReadonlyArray<readonly [number, number]> }
  | { type: 'circle' }

// Visual centre of a form body, in form-fraction [0,1]² space — a triangle's
// centroid is not its bounding-box centre. Lives here (domain), not ui/, so
// BOTH ui/FormNode.tsx (canvas name-label placement) and ir/geometry-ir.ts
// (export name-label placement) can consume the SAME pure math — export
// otherwise sat below ui/ in the layer rule and couldn't import from it.
export function bodyCentroid(body: Body): [number, number] {
  if (body.type === 'circle') return [0.5, 0.5]
  const pts = body.pointsFrac
  let sx = 0, sy = 0
  for (const [x, y] of pts) { sx += x; sy += y }
  return [sx / pts.length, sy / pts.length]
}

export interface FormGeometry {
  shape: Shape
  displayName: string
  // Side/arc keys. A point sits on one of these.
  edgeKeys: readonly EdgeKey[]
  body: Body
  bodyOpacity: number
  // Whether the form's own name renders on the canvas — off for kinds that
  // carry no identity of their own (a functional/anonymous node).
  showName: boolean
  // Whether this kind carves a separate inner "select the whole form" zone
  // out of its body — off for 'empty', which is too small (and whose whole
  // body is already one shared point-creation region) to usefully split
  // into a ring + center.
  hasCenterZone: boolean
  nodeSize: (form: Form) => number
  pointAnchor: (edgeKey: EdgeKey, index: number, count: number, n: number) => Anchor
  // Nearest edge to a normalized cursor (rx, ry) ∈ [0,1]².
  edgeAt: (rx: number, ry: number) => EdgeKey | undefined
  // Overlay shape for hovering/selecting this edgeKey's region.
  regionShape: (edgeKey: EdgeKey) => RegionShape
  // Hard per-edge attachment cap this kind declares, so capacity lives here
  // (geometry) instead of scattered "if kind === 'empty'" checks through
  // mutations/Canvas. Only edges present as keys are capped; an edge absent
  // from the map (or the whole field undefined) is unbounded. When a capped
  // edge is at capacity, mutations.addPoint REUSES its existing point rather
  // than refusing — a drop on a full edge should still CONNECT (many wires,
  // one point). 'empty' declares {self: 1} (its single middle point);
  // 'triangle' declares {peak: 1} (its apex point-attachment slot) — every
  // other edge (triangle's a/b/c, every side of every other shape) is
  // unbounded.
  edgeCapacity?: Partial<Record<EdgeKey, number>>
  // True ONLY for 'empty': its single point (self, capacity 1) IS the form
  // itself — the form can never exist without it. Drives removePoint's
  // cascade-to-deleteForm, addForm's own-point seeding, and Canvas's
  // name-field retargeting (renaming "the form" really renames its one
  // point). A capacity-1 edge on another shape (triangle's peak) is an
  // ordinary OPTIONAL attachment slot instead — the point can be absent, and
  // deleting it deletes just the point, leaving its form intact — so
  // pointIsForm stays false/undefined there even though edgeCapacity caps it
  // at 1 too.
  pointIsForm?: boolean
  // The INVERSE of pointAnchor's own spacing formula for a SIDE edgeKey: given
  // a normalized cursor (rx, ry) ∈ [0,1]² already known to be on/near this
  // edge, returns the same t ∈ [0,1] ordering parameter pointAnchor's t
  // (whatever its per-kind meaning — linear position along a side, or angle
  // around an arc) would have produced for a point sitting there. Single
  // source of truth for "where along this edge did the gesture happen" —
  // insertionIndex below is the only consumer.
  edgeParam: (edgeKey: EdgeKey, rx: number, ry: number) => number
  // The point's TRUE outward unit normal in LOCAL (pre-rotation) node-space
  // — perpendicular to its actual edge (triangle slants, square/rhombus
  // sides), radial for a circle arc, or a vertex's own outward radial
  // direction (triangle's 'peak'). null ONLY for 'empty' (pointIsForm — no
  // meaningful direction, it's a free end). This is the geometry the wire
  // TANGENT is drawn from (domain/wirepath.ts's Dir) — NOT the same thing as
  // pointAnchor's `position` (a coarse Position enum picked mainly for LABEL
  // placement, static per edgeKey, arbitrary for a slanted edge). Exported
  // via worldPointNormal below, the ONE function that also applies the
  // form's own rotation — never consumed directly by callers outside this file.
  pointNormal: (edgeKey: EdgeKey, index: number, count: number) => Vec | null
  // Interior CENTRE spots (square/circle/rhombus) are NOT part of edgeAt's
  // boundary attribution — a cursor over the body's middle otherwise resolves
  // to the nearest side. Canvas resolves them here instead, only when the
  // cursor is inside the centre zone. Returns the centre-spot key within
  // SPOT_DISC_R (its own drawn disc) of the cursor, else undefined — so the
  // indicator appears only where you can actually drag. Absent for shapes with
  // no centre spots.
  centerSpotAt?: (rx: number, ry: number) => EdgeKey | undefined
}

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v))
}

// ── Point outward normals (world-space wire tangent direction) ─────────
// The shared low-level math a straight-edge shape's pointNormal builds on:
// the unit vector perpendicular to segment a->b, picking whichever of the
// two perpendiculars points AWAY from `centroid` (the body's own visual
// centre — bodyCentroid). Circle/'peak' compute their own radial direction
// directly instead (no shared "edge" to derive a perpendicular from).
function outwardEdgeNormal(
  a: readonly [number, number], b: readonly [number, number], centroid: readonly [number, number],
): Vec {
  const ex = b[0] - a[0]
  const ey = b[1] - a[1]
  const len = Math.hypot(ex, ey) || 1
  const nx = ey / len
  const ny = -ex / len
  const midx = (a[0] + b[0]) / 2
  const midy = (a[1] + b[1]) / 2
  const dot = (midx - centroid[0]) * nx + (midy - centroid[1]) * ny
  return dot >= 0 ? { x: nx, y: ny } : { x: -nx, y: -ny }
}

function normalizeVec(x: number, y: number): Vec {
  const len = Math.hypot(x, y) || 1
  return { x: x / len, y: y / len }
}

// Rotates a plain DIRECTION vector (not a position — no center/pivot needed,
// unlike ir/geometry-ir.ts's rotateAbout) by `deg` — clockwise, screen/Y-down
// space, the SAME convention as every other rotation in this codebase
// (FormNode.tsx's CSS `rotate(deg)`, geometry-ir.ts's rotateAbout).
function rotateVec(v: Vec, deg: number): Vec {
  if (!deg) return v
  const th = (deg * Math.PI) / 180
  const cos = Math.cos(th)
  const sin = Math.sin(th)
  return { x: v.x * cos - v.y * sin, y: v.x * sin + v.y * cos }
}

// THE single function both ui/Canvas.tsx (builtEdges) and ir/geometry-ir.ts
// (buildLineCmds) call to get a point's wire-tangent direction — a form's
// own pointNormal (LOCAL, pre-rotation) rotated by that form's `rotation`.
// Fixes both halves of "wrong tangent on triangles/rotated forms": a
// triangle's slanted edges get their OWN true perpendicular (not a coarse
// axis-aligned guess), and ANY form's points turn with it when rotated
// (pointAnchor's `position` never did — it's a static per-edgeKey Position
// picked for label placement, orthogonal to this). null only for a free end
// ('empty'/pointIsForm — pointNormal itself returns null; rotating null is null).
export function worldPointNormal(form: Form, edgeKey: EdgeKey, index: number, count: number): Vec | null {
  const local = geometryFor(form.shape).pointNormal(edgeKey, index, count)
  if (!local) return null
  return rotateVec(local, form.rotation ?? 0)
}

// Where a NEW point's gesture (rx, ry) should land in an edge's existing
// ordered point list — the fix for "wires cross instead of running parallel"
// when two points get created on facing sides in the wrong relative order.
// Generic across every kind: for each of the `count` existing points, re-
// derive ITS OWN t (by asking pointAnchor where it currently sits, then
// inverting that back through edgeParam) and count how many precede the
// gesture's own t. Because edgeParam is the exact inverse of whatever
// spacing formula pointAnchor used to place that point, this stays correct
// for linear sides (t = (i+1)/(count+1)) and circle arcs (t = angle
// fraction) without needing a separate closed-form per kind.
export function insertionIndex(form: Form, edgeKey: EdgeKey, rx: number, ry: number): number {
  const geom = geometryFor(form.shape)
  const ids = form.edges[edgeKey] ?? []
  const count = ids.length
  if (count === 0) return 0
  const tg = geom.edgeParam(edgeKey, rx, ry)
  let k = 0
  for (let i = 0; i < count; i++) {
    // n=1: every pointAnchor formula is linear in n, so fractions come out
    // the same regardless of the actual node size.
    const a = geom.pointAnchor(edgeKey, i, count, 1)
    const ti = geom.edgeParam(edgeKey, a.x, a.y)
    if (ti < tg) k++
  }
  return Math.min(count, k)
}

// ── Shared helpers ───────────────────────────────────────────────────
// The point ids at an edge key — a side's ordered list as-is. Single source
// of "what's here" for rendering/lookup code.
export function pointIdsAt(form: Form, edgeKey: EdgeKey): string[] {
  return form.edges[edgeKey] ?? []
}

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
// bodies; a simple radius test for circle.
export function isInsideBody(body: Body, rx: number, ry: number): boolean {
  if (body.type === 'circle') {
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
// the point-creation edge regions. Hit-test only: hovering the zone
// highlights the form's WHOLE body (FormNode renders that separately), this
// constant only decides where the zone's own boundary sits.
export const CENTER_SHRINK = 0.72

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
// body). null for circle bodies — FormNode draws those as a plain scaled
// circle instead.
export function shrunkBodyPoints(body: Body, shrink: number = CENTER_SHRINK): ReadonlyArray<readonly [number, number]> | null {
  if (body.type !== 'polygon') return null
  return body.pointsFrac.map(([x, y]) => [0.5 + (x - 0.5) * shrink, 0.5 + (y - 0.5) * shrink] as const)
}

// Inset a straight edge's endpoints toward its midpoint by `inset` (fraction
// units) — keeps a side's hover stripe from overlapping an adjacent side's
// stripe at the vertex they share. `inset` is capped at half the segment
// length so short edges (e.g. a rhombus's diagonal sides) never invert into
// a negative-length stripe.
function insetSegment(
  a: readonly [number, number], b: readonly [number, number], inset: number,
): [[number, number], [number, number]] {
  const dx = b[0] - a[0], dy = b[1] - a[1]
  const len = Math.hypot(dx, dy) || 1
  const t = Math.min(inset, len / 2)
  const ux = dx / len, uy = dy / len
  return [[a[0] + ux * t, a[1] + uy * t], [b[0] - ux * t, b[1] - uy * t]]
}

// ── Vertex / interior "spot" slots (the generalized triangle-peak) ────
// A spot is a single-slot attachment at a FIXED form-fraction point — a corner
// vertex, or an interior centre point — exactly like the triangle's apex:
// capacity 1, rendered AT the point, its own radial outward normal, no
// ordering. Every shape's corners and the shared centre points reuse this
// machinery so they behave identically to `peak`.
export interface Spot { at: readonly [number, number]; position: Position }

// Hit radius (form-fraction units) within which a cursor resolves to a spot —
// same magnitude as the triangle apex's PEAK_R, for one consistent "near a
// spot" feel across every shape.
const SPOT_R = CORNER_R

// A spot's hit radius when the indicator should coincide with the drag disc:
// the drawn disc's OWN radius (POINT_SIZE), NOT the larger SPOT_R. Used for both
// the interior centre spots (so the rest of the centre zone stays plain
// form-selection instead of flickering the draw dot) and the corner spots (so a
// corner's indicator appears EXACTLY where a wire can be dragged from it — its
// "self-region" — leaving the near-vertex ends of the sides grabbable again).
const SPOT_DISC_R = POINT_SIZE / BASE_SIZE / 2

function spotAnchor(spot: Spot, n: number): Anchor {
  return { x: spot.at[0] * n, y: spot.at[1] * n, position: spot.position }
}
function spotNormal(spot: Spot, centroid: readonly [number, number]): Vec {
  return normalizeVec(spot.at[0] - centroid[0], spot.at[1] - centroid[1])
}
// NEAREST spot in `spots` whose anchor is within SPOT_R of (rx, ry), else
// undefined — the peak-style "vertex wins over side" hit-test, reused by every
// shape's edgeAt (for corner spots) and by Canvas's centre zone (centre spots).
// Nearest-wins (not first-match) so the three co-linear centre spots
// (centre-up / centre / centre-down) split cleanly along the vertical midline.
function spotAt(spots: Record<string, Spot>, rx: number, ry: number, radius: number = SPOT_R): EdgeKey | undefined {
  let best: EdgeKey | undefined
  let bestD = Infinity
  for (const key of Object.keys(spots)) {
    const [cx, cy] = spots[key].at
    const d = Math.hypot(rx - cx, ry - cy)
    if (d <= radius && d < bestD) { bestD = d; best = key }
  }
  return best
}
// Per-key capacity map (all 1) for a shape's spot keys — folded into
// edgeCapacity so every spot caps at one point and REUSES it on a second drop,
// exactly like `peak`/`self`.
function spotCapacities(keys: readonly string[]): Partial<Record<EdgeKey, number>> {
  return Object.fromEntries(keys.map((k) => [k, 1]))
}

// The `center` IDENTITY spot — dead-centre, where the name sits: every form has
// one, and it represents the WHOLE form. Drawing a wire OUT of it places this
// sysmer into another form's slot (F1.center → F2.corner-i ⇒ F2's i-corner
// holds F1). At the centroid it has no outward direction, so its pointNormal is
// null (a free end, like empty's self-point).
const IDENTITY_SPOT: Record<string, Spot> = {
  center: { at: [0.5, 0.5], position: Position.Bottom },
}
// The interior CENTRE spots. `center-up`/`center-down` (square/circle/rhombus)
// sit halfway between the centre and the top/bottom; `center` (every form) is
// the identity dot. Interior, so Canvas resolves them via geometry.centerSpotAt
// INSIDE the centre zone, not through edgeAt's boundary attribution.
const CENTER_SPOTS: Record<string, Spot> = {
  'center-up': { at: [0.5, 0.25], position: Position.Top },
  'center-down': { at: [0.5, 0.75], position: Position.Bottom },
  ...IDENTITY_SPOT,
}
const CENTER_SPOT_KEYS = ['center-up', 'center-down', 'center'] as const

// ── TRIANGLE — apex points RIGHT (the standard orientation). Sides:
//   a = top slant (top-left → apex), b = bottom slant (bottom-left → apex),
//   c = left side (top-left → bottom-left, vertical).
//
// Vertex geometry is chosen so the triangle is INSCRIBED in the circle of
// radius TRI_R centred at (0.5, 0.5) — same principle as the app's own brand
// mark (a diamond inscribed in a circle inscribed in a square) — rather than
// merely fit inside the [0,1]² box at rest. That distinction matters because
// FormNode.tsx/geometry-ir.ts pivot rotation around bodyCentroid (this
// shape's own centroid, which for an equilateral triangle IS the circle's
// center), not the box's center: any vertex farther from the centroid than
// the box's nearest edge would swing outside the box at some rotation angle.
// Circumradius exactly 0.5 (half the box's side) guarantees every vertex
// stays on the inscribed circle — and therefore inside the box — at EVERY
// rotation angle, with the vertices only ever touching, never crossing, the
// box's edges. (The PRIOR geometry instead maximized the triangle's own
// footprint inside the box at rest — apex flush against the right edge, base
// flush against top/bottom — which gave it a circumradius of n/√3 ≈ 0.577n,
// bigger than the 0.356n gap from centroid to nearest box edge: no pivot
// choice could keep THAT triangle inside its box across all angles.)
const TRI_R = 0.5 // circumradius: centroid-to-vertex distance, == half the box
const SQRT3_4 = Math.sqrt(3) / 4 // == TRI_R * sin(60°) — half the base's
                                 // vertical span (see TRI_BASE_Y_TOP/BOT
                                 // below); an exact coincidence of TRI_R
                                 // being exactly 0.5, not a general identity
const TRI_APEX_X = 0.5 + TRI_R // = 1.0 (rightmost point, touches the right edge)
const TRI_APEX_Y = 0.5
const TRI_BASE_X = 0.5 - TRI_R * Math.cos(Math.PI / 3) // = 0.25 (left, vertical base)
const TRI_BASE_Y_TOP = 0.5 - SQRT3_4 // ≈ 0.067 (base's top vertex, side 'a')
const TRI_BASE_Y_BOT = 0.5 + SQRT3_4 // ≈ 0.933 (base's bottom vertex, side 'b')
// Centroid of the 3 vertices (apex, base-top, base-bottom) — used by
// pointNormal below to pick which of a slant edge's two perpendiculars
// points OUTWARD, and as 'peak's own outward (radial) direction. Precomputed
// from the same constants bodyCentroid(triangleGeometry.body) would derive
// at runtime, just without the self-reference.
const TRI_CENTROID: readonly [number, number] = [
  (TRI_APEX_X + TRI_BASE_X + TRI_BASE_X) / 3,
  (TRI_APEX_Y + TRI_BASE_Y_TOP + TRI_BASE_Y_BOT) / 3,
]
// 'peak' is the triangle's apex vertex — a single point-attachment SLOT (at
// most one point, like 'empty's middle point, but optional: the triangle
// survives without it — see edgeCapacity/pointIsForm below) rather than an
// ordinary side that fans out multiple points.
const TRI_EDGES = ['a', 'b', 'c', 'peak', 'corner-base-top', 'corner-base-bottom', 'center'] as const
// The triangle's two BASE vertices as spot slots (the apex is 'peak'). Same
// peak recipe — each an optional, capacity-1 attachment at its vertex.
const TRI_CORNERS: Record<string, Spot> = {
  'corner-base-top': { at: [TRI_BASE_X, TRI_BASE_Y_TOP], position: Position.Top },
  'corner-base-bottom': { at: [TRI_BASE_X, TRI_BASE_Y_BOT], position: Position.Bottom },
}
// Base corners + the identity `center` (at the centroid, which for the
// inscribed equilateral triangle IS [0.5, 0.5]) — for the position/region/
// param methods. edgeAt still uses only TRI_CORNERS; `center` is interior.
const TRI_SPOTS: Record<string, Spot> = { ...TRI_CORNERS, ...IDENTITY_SPOT }
// Radius (form-fraction units) within which a cursor near the apex resolves
// to the 'peak' slot, checked BEFORE side (a/b/c) attribution — same
// magnitude as CORNER_R (the side-stripe inset), for the same "near a
// vertex" feel. Left unchanged even though the triangle shrank (~13%
// linearly, going from footprint-maximizing to inscribed-circumradius
// sizing): PEAK_R is a hit-radius in the SAME [0,1]² fraction space as the
// vertices, so it shrinks right along with the triangle in absolute
// (post-nodeSize) terms — its proportion relative to the triangle's own
// size is unchanged, so it doesn't read as disproportionate.
const PEAK_R = CORNER_R

// A point along slant 'a' (from the top-left base vertex) or 'b' (bottom-left),
// running to the apex on the right.
function triSlant(side: 'a' | 'b', t: number, n: number): [number, number] {
  const by = (side === 'a' ? TRI_BASE_Y_TOP : TRI_BASE_Y_BOT) * n
  const bx = TRI_BASE_X * n
  return [bx + (TRI_APEX_X * n - bx) * t, by + (0.5 * n - by) * t]
}

const triangleGeometry: FormGeometry = {
  shape: 'triangle',
  displayName: 'Triangle',
  edgeKeys: TRI_EDGES,
  body: { type: 'polygon', pointsFrac: [[TRI_APEX_X, 0.5], [TRI_BASE_X, TRI_BASE_Y_BOT], [TRI_BASE_X, TRI_BASE_Y_TOP]] },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: () => BASE_SIZE,
  edgeCapacity: { peak: 1, ...spotCapacities(Object.keys(TRI_SPOTS)) },
  centerSpotAt: (rx, ry) => spotAt(IDENTITY_SPOT, rx, ry, SPOT_DISC_R),
  pointAnchor: (edgeKey, index, count, n) => {
    // 'peak' has capacity 1 — always the apex itself, regardless of
    // index/count (same "constant anchor" pattern as emptyGeometry's middle
    // point). Facing Position.Right: the triangle points right, so its own
    // label/handle should face further right, away from the body.
    if (edgeKey === 'peak') return { x: TRI_APEX_X * n, y: TRI_APEX_Y * n, position: Position.Right }
    const spot = TRI_SPOTS[edgeKey]
    if (spot) return spotAnchor(spot, n)
    const t = (index + 1) / (count + 1)
    if (edgeKey === 'a') { const [x, y] = triSlant('a', t, n); return { x, y, position: Position.Top } }
    if (edgeKey === 'b') { const [x, y] = triSlant('b', t, n); return { x, y, position: Position.Bottom } }
    return { x: TRI_BASE_X * n, y: TRI_BASE_Y_TOP * n + t * (TRI_BASE_Y_BOT - TRI_BASE_Y_TOP) * n, position: Position.Left } // c = left vertical side
  },
  edgeAt: (rx, ry) => {
    // The apex slot wins over side attribution within PEAK_R — checked
    // first, since 'a' and 'b' both terminate exactly at the apex and would
    // otherwise always claim a cursor there.
    if (Math.hypot(rx - TRI_APEX_X, ry - TRI_APEX_Y) <= PEAK_R) return 'peak'
    // Base-vertex spots win over side attribution the same way (both slants and
    // 'c' terminate at these two vertices), checked before a/b/c.
    const corner = spotAt(TRI_CORNERS, rx, ry, SPOT_DISC_R)
    if (corner) return corner
    const da = distToSeg(rx, ry, TRI_BASE_X, TRI_BASE_Y_TOP, TRI_APEX_X, 0.5) // a = top slant
    const db = distToSeg(rx, ry, TRI_BASE_X, TRI_BASE_Y_BOT, TRI_APEX_X, 0.5) // b = bottom slant
    const dc = distToSeg(rx, ry, TRI_BASE_X, TRI_BASE_Y_TOP, TRI_BASE_X, TRI_BASE_Y_BOT) // c = left side
    if (da <= db && da <= dc) return 'a'
    if (db <= dc) return 'b'
    return 'c'
  },
  regionShape: (edgeKey) => {
    if (edgeKey === 'peak') return { kind: 'spot', at: [TRI_APEX_X, TRI_APEX_Y] }
    if (TRI_SPOTS[edgeKey]) return { kind: 'spot', at: TRI_SPOTS[edgeKey].at }
    if (edgeKey === 'a') return { kind: 'polyline', points: insetSegment([TRI_BASE_X, TRI_BASE_Y_TOP], [TRI_APEX_X, 0.5], CORNER_R) }
    if (edgeKey === 'b') return { kind: 'polyline', points: insetSegment([TRI_BASE_X, TRI_BASE_Y_BOT], [TRI_APEX_X, 0.5], CORNER_R) }
    return { kind: 'polyline', points: insetSegment([TRI_BASE_X, TRI_BASE_Y_TOP], [TRI_BASE_X, TRI_BASE_Y_BOT], CORNER_R) } // c
  },
  // Inverse of triSlant's t (y runs TRI_BASE_Y_TOP→0.5 for 'a',
  // TRI_BASE_Y_BOT→0.5 for 'b') / the direct linear t=(y-top)/(bot-top)
  // assignment for 'c' (see pointAnchor above). 'peak' has no ordering
  // (capacity 1, like 'empty's self) — the constant 0 is the trivial (and
  // only) valid inverse.
  edgeParam: (edgeKey, _rx, ry) => {
    if (edgeKey === 'peak' || TRI_SPOTS[edgeKey]) return 0
    if (edgeKey === 'a') return clamp01((ry - TRI_BASE_Y_TOP) / (0.5 - TRI_BASE_Y_TOP))
    if (edgeKey === 'b') return clamp01((TRI_BASE_Y_BOT - ry) / (TRI_BASE_Y_BOT - 0.5))
    return clamp01((ry - TRI_BASE_Y_TOP) / (TRI_BASE_Y_BOT - TRI_BASE_Y_TOP)) // c
  },
  // 'peak' (a vertex, not an edge): outward = radial, centroid through the
  // apex. 'a'/'b'/'c' (slant/base edges): the TRUE perpendicular of that
  // edge's own two vertices, picked outward via TRI_CENTROID — NOT the
  // coarse Position.Top/Bottom/Left pointAnchor above uses (those are label-
  // placement picks, arbitrary for a 60°/-60° slant). Constant per edgeKey
  // (a straight edge has one direction regardless of where along it a point
  // sits) — index/count unused, unlike circle's pointNormal below.
  pointNormal: (edgeKey) => {
    if (edgeKey === 'peak') return normalizeVec(TRI_APEX_X - TRI_CENTROID[0], TRI_APEX_Y - TRI_CENTROID[1])
    if (edgeKey === 'center') return null
    if (TRI_CORNERS[edgeKey]) return spotNormal(TRI_CORNERS[edgeKey], TRI_CENTROID)
    if (edgeKey === 'a') return outwardEdgeNormal([TRI_BASE_X, TRI_BASE_Y_TOP], [TRI_APEX_X, 0.5], TRI_CENTROID)
    if (edgeKey === 'b') return outwardEdgeNormal([TRI_BASE_X, TRI_BASE_Y_BOT], [TRI_APEX_X, 0.5], TRI_CENTROID)
    return outwardEdgeNormal([TRI_BASE_X, TRI_BASE_Y_TOP], [TRI_BASE_X, TRI_BASE_Y_BOT], TRI_CENTROID) // c
  },
}

// ── SQUARE (4 sides) ──────────────────────────────────────────────────
const SQUARE_EDGES = ['top', 'right', 'bottom', 'left', 'corner-tl', 'corner-tr', 'corner-br', 'corner-bl', 'center-up', 'center-down', 'center'] as const
// The square's four corner vertices as spot slots (labels face away from the
// body). Merged with the shared centre spots for the position/region/normal
// methods; edgeAt uses only the corners (centres are interior — centerSpotAt).
const SQUARE_CORNERS: Record<string, Spot> = {
  'corner-tl': { at: [0, 0], position: Position.Left },
  'corner-tr': { at: [1, 0], position: Position.Right },
  'corner-br': { at: [1, 1], position: Position.Right },
  'corner-bl': { at: [0, 1], position: Position.Left },
}
const SQUARE_SPOTS: Record<string, Spot> = { ...SQUARE_CORNERS, ...CENTER_SPOTS }

const squareGeometry: FormGeometry = {
  shape: 'square',
  displayName: 'Square',
  edgeKeys: SQUARE_EDGES,
  body: { type: 'polygon', pointsFrac: [[0, 0], [1, 0], [1, 1], [0, 1]] },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: () => BASE_SIZE,
  edgeCapacity: spotCapacities([...Object.keys(SQUARE_CORNERS), ...CENTER_SPOT_KEYS]),
  centerSpotAt: (rx, ry) => spotAt(CENTER_SPOTS, rx, ry, SPOT_DISC_R),
  pointAnchor: (edgeKey, index, count, n) => {
    const spot = SQUARE_SPOTS[edgeKey]
    if (spot) return spotAnchor(spot, n)
    const t = (index + 1) / (count + 1)
    switch (edgeKey) {
      case 'top': return { x: t * n, y: 0, position: Position.Top }
      case 'right': return { x: n, y: t * n, position: Position.Right }
      case 'bottom': return { x: t * n, y: n, position: Position.Bottom }
      default: return { x: 0, y: t * n, position: Position.Left }
    }
  },
  edgeAt: (rx, ry) => {
    const corner = spotAt(SQUARE_CORNERS, rx, ry, SPOT_DISC_R)
    if (corner) return corner
    const d = { top: ry, right: 1 - rx, bottom: 1 - ry, left: rx }
    return (Object.keys(d) as Array<keyof typeof d>).reduce((a, b) => (d[b] < d[a] ? b : a))
  },
  regionShape: (edgeKey) => {
    const spot = SQUARE_SPOTS[edgeKey]
    if (spot) return { kind: 'spot', at: spot.at }
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
    if (SQUARE_SPOTS[edgeKey]) return 0
    switch (edgeKey) {
      case 'top': case 'bottom': return clamp01(rx)
      default: return clamp01(ry) // left/right
    }
  },
  // Same 4 vertex pairs regionShape draws its hover stripes from (pre-inset
  // — inset doesn't change a segment's direction), outward via
  // outwardEdgeNormal — reduces to the plain axis-aligned unit vectors
  // (0,-1)/(1,0)/(0,1)/(-1,0) for an unrotated square, matching the old
  // static Position mapping exactly; worldPointNormal rotates it from there.
  // Spots (corners/centres) use their own radial normal from the body centre;
  // the dead-centre identity spot has no direction (null, a free end).
  pointNormal: (edgeKey) => {
    if (edgeKey === 'center') return null
    const spot = SQUARE_SPOTS[edgeKey]
    if (spot) return spotNormal(spot, [0.5, 0.5])
    switch (edgeKey) {
      case 'top': return outwardEdgeNormal([0, 0], [1, 0], [0.5, 0.5])
      case 'right': return outwardEdgeNormal([1, 0], [1, 1], [0.5, 0.5])
      case 'bottom': return outwardEdgeNormal([0, 1], [1, 1], [0.5, 0.5])
      default: return outwardEdgeNormal([0, 0], [0, 1], [0.5, 0.5]) // left
    }
  },
}

// ── CIRCLE (4 cardinal arcs up/right/down/left; no vertices) ─────────
// Each arc spans 90° centred on a cardinal direction, with boundaries at the
// diagonals: 'up' = the top quarter (NW→N→NE), etc.
const CIRCLE_EDGES = ['up', 'right', 'down', 'left', 'center-up', 'center-down', 'center'] as const
const ARC_START: Record<string, number> = {
  up: (3 * Math.PI) / 4, right: Math.PI / 4, down: -Math.PI / 4, left: -(3 * Math.PI) / 4,
}
const ARC_POSITION: Record<string, Position> = { up: Position.Top, right: Position.Right, down: Position.Bottom, left: Position.Left }
// θ at ordering parameter t along `edgeKey`'s 90° arc — the ONE formula
// arcPt (a point's absolute node-space position) and circleGeometry's
// pointNormal (that SAME point's outward radial direction, which for a
// circle is just (cosθ, −sinθ), no r needed) both derive from, so they can
// never drift apart on which point is "at t" on which arc.
function arcTheta(edgeKey: string, t: number): number {
  return ARC_START[edgeKey] - t * (Math.PI / 2)
}
function arcPt(edgeKey: string, t: number, n: number): [number, number] {
  const r = n / 2
  const theta = arcTheta(edgeKey, t)
  return [n / 2 + r * Math.cos(theta), n / 2 - r * Math.sin(theta)]
}

// Inverse of arcPt's own x/y assignment (x = n/2 + r·cosθ, y = n/2 − r·sinθ,
// centred at fraction (0.5, 0.5)) — recovers θ from a normalized cursor, for
// the circle arcs' edgeAt/edgeParam.
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
  shape: 'circle',
  displayName: 'Circle',
  edgeKeys: CIRCLE_EDGES,
  body: { type: 'circle' },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: () => BASE_SIZE,
  edgeCapacity: spotCapacities(CENTER_SPOT_KEYS),
  centerSpotAt: (rx, ry) => spotAt(CENTER_SPOTS, rx, ry, SPOT_DISC_R),
  pointAnchor: (edgeKey, index, count, n) => {
    const spot = CENTER_SPOTS[edgeKey]
    if (spot) return spotAnchor(spot, n)
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
  regionShape: (edgeKey) => {
    const spot = CENTER_SPOTS[edgeKey]
    if (spot) return { kind: 'spot', at: spot.at }
    return { kind: 'polyline', points: arcRegionPoints(edgeKey) }
  },
  // Inverse of arcPt's θ = ARC_START[edgeKey] − t·(π/2): recover θ, then
  // undo that subtraction — normalized into [0, 2π) first since 'left'
  // wraps across the ±π seam (ARC_START.left = −3π/4, so its far end lands
  // past π).
  edgeParam: (edgeKey, rx, ry) => {
    if (CENTER_SPOTS[edgeKey]) return 0
    const theta = angleFromFraction(rx, ry)
    const raw = ARC_START[edgeKey] - theta
    const norm = ((raw % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
    return clamp01(norm / (Math.PI / 2))
  },
  // Radial — the SAME arcTheta formula arcPt itself uses, so a point's
  // outward normal always agrees with where arcPt actually placed it.
  // Unlike the other shapes, this genuinely varies by index/count (each
  // point along the arc faces its own direction, not one constant per edgeKey).
  pointNormal: (edgeKey, index, count) => {
    if (edgeKey === 'center') return null
    const spot = CENTER_SPOTS[edgeKey]
    if (spot) return spotNormal(spot, [0.5, 0.5])
    const t = (index + 1) / (count + 1)
    const theta = arcTheta(edgeKey, t)
    return { x: Math.cos(theta), y: -Math.sin(theta) }
  },
}

// ── RHOMBUS (diamond orientation — 4 sides, same shape as SQUARE just named
//   for diagonal sides). RHOMBUS_VERTS are the four vertex positions used
//   only internally to define each side's endpoints — v0 = top, v1 = right,
//   v2 = bottom, v3 = left. Sides run clockwise between adjacent vertices.
const RHOMBUS_VERTS = { v0: [0.5, 0], v1: [1, 0.5], v2: [0.5, 1], v3: [0, 0.5] } as const
const RHOMBUS_EDGES = ['top-right', 'bottom-right', 'bottom-left', 'top-left', 'corner-top', 'corner-right', 'corner-bottom', 'corner-left', 'center-up', 'center-down', 'center'] as const
// The rhombus's four vertices as spot slots (labels face outward), merged with
// the shared centre spots. edgeAt uses only the corners; centres are interior.
const RHOMBUS_CORNERS: Record<string, Spot> = {
  'corner-top': { at: RHOMBUS_VERTS.v0, position: Position.Top },
  'corner-right': { at: RHOMBUS_VERTS.v1, position: Position.Right },
  'corner-bottom': { at: RHOMBUS_VERTS.v2, position: Position.Bottom },
  'corner-left': { at: RHOMBUS_VERTS.v3, position: Position.Left },
}
const RHOMBUS_SPOTS: Record<string, Spot> = { ...RHOMBUS_CORNERS, ...CENTER_SPOTS }
const RHOMBUS_SIDES: Record<string, { a: readonly [number, number]; b: readonly [number, number]; position: Position }> = {
  'top-right': { a: RHOMBUS_VERTS.v0, b: RHOMBUS_VERTS.v1, position: Position.Top },
  'bottom-right': { a: RHOMBUS_VERTS.v1, b: RHOMBUS_VERTS.v2, position: Position.Bottom },
  'bottom-left': { a: RHOMBUS_VERTS.v2, b: RHOMBUS_VERTS.v3, position: Position.Bottom },
  'top-left': { a: RHOMBUS_VERTS.v3, b: RHOMBUS_VERTS.v0, position: Position.Top },
}
const lerp = (a: readonly [number, number], b: readonly [number, number], t: number): [number, number] =>
  [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]

const rhombusGeometry: FormGeometry = {
  shape: 'rhombus',
  displayName: 'Rhombus',
  edgeKeys: RHOMBUS_EDGES,
  body: { type: 'polygon', pointsFrac: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
  bodyOpacity: 1,
  showName: true,
  hasCenterZone: true,
  nodeSize: () => BASE_SIZE,
  edgeCapacity: spotCapacities([...Object.keys(RHOMBUS_CORNERS), ...CENTER_SPOT_KEYS]),
  centerSpotAt: (rx, ry) => spotAt(CENTER_SPOTS, rx, ry, SPOT_DISC_R),
  pointAnchor: (edgeKey, index, count, n) => {
    const spot = RHOMBUS_SPOTS[edgeKey]
    if (spot) return spotAnchor(spot, n)
    const side = RHOMBUS_SIDES[edgeKey]
    const t = (index + 1) / (count + 1)
    const [x, y] = lerp(side.a, side.b, t)
    return { x: x * n, y: y * n, position: side.position }
  },
  edgeAt: (rx, ry) => {
    const corner = spotAt(RHOMBUS_CORNERS, rx, ry, SPOT_DISC_R)
    if (corner) return corner
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
    const spot = RHOMBUS_SPOTS[edgeKey]
    if (spot) return { kind: 'spot', at: spot.at }
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
  // Same RHOMBUS_SIDES vertex pairs regionShape's hover stripe uses, outward
  // via outwardEdgeNormal — constant per edgeKey, like triangle/square (a
  // straight side has one direction). Spots (corners/centres) use their own
  // radial normal from the body centre; the dead-centre identity spot is null.
  pointNormal: (edgeKey) => {
    if (edgeKey === 'center') return null
    const spot = RHOMBUS_SPOTS[edgeKey]
    if (spot) return spotNormal(spot, [0.5, 0.5])
    const side = RHOMBUS_SIDES[edgeKey]
    return outwardEdgeNormal(side.a, side.b, [0.5, 0.5])
  },
}

// ── EMPTY — an invisible carrier form (bodyOpacity 0, no name of its own).
// Deliberately the simplest kind: it holds AT MOST ONE point — the middle
// point IS the form, always rendered dead-center regardless of how many
// wires run to it (many lines, one point; see mutations.addPoint's
// edgeCapacity reuse). A wire dragged out into empty canvas space
// auto-creates one of these to land on (see Canvas.tsx's onConnectEnd);
// dropping on an existing one reuses its point instead of fanning a second
// one out beside it.
const EMPTY_EDGE = 'self'
const EMPTY_MAX_POINTS = 1

const emptyGeometry: FormGeometry = {
  shape: 'empty',
  displayName: 'Empty',
  edgeKeys: [EMPTY_EDGE],
  body: { type: 'circle' },
  bodyOpacity: 0,
  showName: false,
  hasCenterZone: false,
  edgeCapacity: { [EMPTY_EDGE]: EMPTY_MAX_POINTS },
  pointIsForm: true,
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
  // The one middle point IS the form (pointIsForm) — a free end, no
  // meaningful direction. worldPointNormal/wirePath read this null as "leave
  // straight toward the other endpoint" (bezier) / "no stub, turn exactly at
  // this point" (smoothstep).
  pointNormal: () => null,
}

// ── Registry ─────────────────────────────────────────────────────────
export const formRegistry: Record<Shape, FormGeometry> = {
  triangle: triangleGeometry,
  square: squareGeometry,
  circle: circleGeometry,
  rhombus: rhombusGeometry,
  empty: emptyGeometry,
}

export function geometryFor(shape: Shape): FormGeometry {
  return formRegistry[shape]
}

// The full, runtime-checkable set of valid Shapes — formRegistry's own keys,
// so this can never drift from the geometry registry above. io.ts's
// canonPoint uses this to drop-silently normalize a legacy/unknown point
// shape to 'empty' on load.
export const SHAPES: readonly Shape[] = Object.keys(formRegistry) as Shape[]
