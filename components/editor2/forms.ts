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

export type Body =
  | { type: 'polygon'; pointsFrac: ReadonlyArray<readonly [number, number]> }
  | { type: 'circle' }

export interface FormGeometry {
  kind: FormKind
  displayName: string
  // Side keys + corner keys. A point sits on one of these (edge or vertex).
  edgeKeys: readonly EdgeKey[]
  // Which of edgeKeys are vertices, mapped to their position in form-fractions.
  corners: Readonly<Record<EdgeKey, readonly [number, number]>>
  body: Body
  bodyOpacity: number
  nodeSize: (form: Form) => number
  pointAnchor: (edgeKey: EdgeKey, index: number, count: number, n: number) => Anchor
  // Nearest edge/corner to a normalized cursor (rx, ry) ∈ [0,1]².
  edgeAt: (rx: number, ry: number) => EdgeKey | undefined
}

// ── Shared helpers ───────────────────────────────────────────────────
function maxPointsOnAnyEdge(form: Form, edgeKeys: readonly EdgeKey[]): number {
  let m = 0
  for (const k of edgeKeys) {
    const len = form.edges[k]?.length ?? 0
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

// ── TRIANGLE (apex up; sides a/b/c, corners v0=apex, v1=base-right, v2=base-left) ─
const SQRT3_4 = Math.sqrt(3) / 4
const TRI_TOP = 0.5 - SQRT3_4
const TRI_BOT = 0.5 + SQRT3_4
const TRI_CORNERS = { v0: [0.5, TRI_TOP], v1: [1, TRI_BOT], v2: [0, TRI_BOT] } as const
const TRI_EDGES = ['a', 'b', 'c', 'v0', 'v1', 'v2'] as const

function triSlant(side: 'a' | 'b', t: number, n: number): [number, number] {
  const baseX = side === 'a' ? 0 : n
  return [baseX + (n / 2 - baseX) * t, TRI_BOT * n + (TRI_TOP * n - TRI_BOT * n) * t]
}

const triangleGeometry: FormGeometry = {
  kind: 'triangle',
  displayName: 'Triangle',
  edgeKeys: TRI_EDGES,
  corners: TRI_CORNERS,
  body: { type: 'polygon', pointsFrac: [[0.5, TRI_TOP], [1, TRI_BOT], [0, TRI_BOT]] },
  bodyOpacity: 1,
  nodeSize: sizeFor(TRI_EDGES),
  pointAnchor: (edgeKey, index, count, n) => {
    if (edgeKey in TRI_CORNERS) return cornerAnchor(TRI_CORNERS[edgeKey as keyof typeof TRI_CORNERS], index, n)
    const t = (index + 1) / (count + 1)
    if (edgeKey === 'a') { const [x, y] = triSlant('a', t, n); return { x, y, position: Position.Left } }
    if (edgeKey === 'b') { const [x, y] = triSlant('b', t, n); return { x, y, position: Position.Right } }
    return { x: t * n, y: TRI_BOT * n, position: Position.Bottom }
  },
  edgeAt: (rx, ry) => {
    const nc = nearestCorner(rx, ry, TRI_CORNERS)
    if (nc && nc.dist < CORNER_R) return nc.key
    const da = distToSeg(rx, ry, 0, TRI_BOT, 0.5, TRI_TOP) // a = left slant
    const db = distToSeg(rx, ry, 1, TRI_BOT, 0.5, TRI_TOP) // b = right slant
    const dc = distToSeg(rx, ry, 0, TRI_BOT, 1, TRI_BOT) // c = base
    if (da <= db && da <= dc) return 'a'
    if (db <= dc) return 'b'
    return 'c'
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

const circleGeometry: FormGeometry = {
  kind: 'circle',
  displayName: 'Circle',
  edgeKeys: CIRCLE_EDGES,
  corners: {},
  body: { type: 'circle' },
  bodyOpacity: 1,
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
}

// ── Stubs (non-functional until later) ───────────────────────────────
const stubAnchor = (_e: EdgeKey, _i: number, _c: number, n: number): Anchor => ({ x: n / 2, y: n / 2, position: Position.Top })

const rhombusGeometry: FormGeometry = {
  kind: 'rhombus', displayName: 'Rhombus', edgeKeys: [], corners: {},
  body: { type: 'polygon', pointsFrac: [[0.5, 0], [1, 0.5], [0.5, 1], [0, 0.5]] },
  bodyOpacity: 1, nodeSize: () => BASE_SIZE, pointAnchor: stubAnchor, edgeAt: () => undefined,
}

const emptyGeometry: FormGeometry = {
  kind: 'empty', displayName: 'Empty', edgeKeys: [], corners: {},
  body: { type: 'circle' }, bodyOpacity: 0, nodeSize: () => BASE_SIZE / 2, pointAnchor: stubAnchor, edgeAt: () => undefined,
}

// ── Registry ─────────────────────────────────────────────────────────
export const formRegistry: Record<FormKind, FormGeometry> = {
  triangle: triangleGeometry,
  square: squareGeometry,
  circle: circleGeometry,
  rhombus: rhombusGeometry,
  empty: emptyGeometry,
}

export function geometryFor(kind: FormKind): FormGeometry {
  return formRegistry[kind]
}
