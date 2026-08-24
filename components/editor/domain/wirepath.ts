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

// The outward normal of an endpoint's form edge — 'up'/'down'/'left'/'right'
// in flow (screen) space, or null for a free end / a 'self' point on an
// 'empty' form (no meaningful single direction). Both call sites derive this
// from the SAME per-point cardinal domain/forms.ts's pointAnchor already
// computes (FormNode.tsx's Handle `position`, PointPx.cardinal in
// geometry-ir.ts) via dirFromCardinal below — never re-derived independently.
export type Dir = 'left' | 'right' | 'up' | 'down' | null

export interface Vec {
  x: number
  y: number
}

export interface WirePathResult {
  d: string
  c1?: Vec
  c2?: Vec
  mid: Vec
}

// React Flow's Position enum ('left'|'top'|'right'|'bottom') and geometry-ir
// .ts's PointPx.cardinal (String(anchor.position), the SAME strings) both
// funnel through here — the one place a cardinal turns into an outward normal.
export function dirFromCardinal(cardinal: string | null | undefined): Dir {
  switch (cardinal) {
    case 'top': return 'up'
    case 'right': return 'right'
    case 'bottom': return 'down'
    case 'left': return 'left'
    default: return null
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function dirUnit(dir: Dir): Vec | null {
  switch (dir) {
    case 'left': return { x: -1, y: 0 }
    case 'right': return { x: 1, y: 0 }
    case 'up': return { x: 0, y: -1 }
    case 'down': return { x: 0, y: 1 }
    default: return null
  }
}

function fmt(n: number): string {
  // Trims float noise (e.g. 12.000000001) without rounding visible precision
  // away — paths are drawn at screen scale, not exported to a fixed grid.
  return (Math.round(n * 1000) / 1000).toString()
}

function vfmt(v: Vec): string {
  return `${fmt(v.x)} ${fmt(v.y)}`
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
  const su = dirUnit(sDir) ?? { x: dx / dist, y: dy / dist }
  const tu = dirUnit(tDir) ?? { x: -dx / dist, y: -dy / dist }
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

// The raw (pre-rounded) elbow route: S -> [S1] -> mid1 -> mid2 -> [T1] -> T,
// deduped of consecutive coincident points. S1/T1 are the outward-offset
// "leave/arrive" stubs (skipped when that endpoint's Dir is null); mid1/mid2
// are the single mid-axis elbow's own corner points. Exported so
// export/tikz.ts can draw the SAME route as a native `--`-segment polyline
// (with `rounded corners=`) instead of parsing the SVG `d` string this
// module also builds for the canvas/HTML-SVG path.
export function smoothstepElbowPoints(sx: number, sy: number, sDir: Dir, tx: number, ty: number, tDir: Dir): Vec[] {
  const sv = dirUnit(sDir)
  const tv = dirUnit(tDir)
  const s1: Vec = sv ? { x: sx + sv.x * STEP_OFFSET, y: sy + sv.y * STEP_OFFSET } : { x: sx, y: sy }
  const t1: Vec = tv ? { x: tx + tv.x * STEP_OFFSET, y: ty + tv.y * STEP_OFFSET } : { x: tx, y: ty }
  // Horizontal elbow (turn on a mid-X vertical) when the source leaves
  // horizontally, or (source Dir null) when the endpoints are horizontally
  // dominant; vertical elbow (mid-Y) otherwise.
  const horizontal =
    sDir === 'left' || sDir === 'right' ? true :
    sDir === 'up' || sDir === 'down' ? false :
    Math.abs(tx - sx) >= Math.abs(ty - sy)
  let mid1: Vec, mid2: Vec
  if (horizontal) {
    const midX = (s1.x + t1.x) / 2
    mid1 = { x: midX, y: s1.y }
    mid2 = { x: midX, y: t1.y }
  } else {
    const midY = (s1.y + t1.y) / 2
    mid1 = { x: s1.x, y: midY }
    mid2 = { x: t1.x, y: midY }
  }
  const raw: Vec[] = [{ x: sx, y: sy }]
  if (sv) raw.push(s1)
  raw.push(mid1, mid2)
  if (tv) raw.push(t1)
  raw.push({ x: tx, y: ty })
  const pts: Vec[] = []
  for (const p of raw) {
    const last = pts[pts.length - 1]
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > 1e-6) pts.push(p)
  }
  return pts
}

// The middle segment's own midpoint — the label anchor for a smoothstep
// wire. Independent of rounding (rounding only trims the polyline's
// corners inward within each segment's own span).
function smoothstepMid(sx: number, sy: number, sDir: Dir, tx: number, ty: number, tDir: Dir): Vec {
  const sv = dirUnit(sDir)
  const tv = dirUnit(tDir)
  const s1: Vec = sv ? { x: sx + sv.x * STEP_OFFSET, y: sy + sv.y * STEP_OFFSET } : { x: sx, y: sy }
  const t1: Vec = tv ? { x: tx + tv.x * STEP_OFFSET, y: ty + tv.y * STEP_OFFSET } : { x: tx, y: ty }
  const horizontal =
    sDir === 'left' || sDir === 'right' ? true :
    sDir === 'up' || sDir === 'down' ? false :
    Math.abs(tx - sx) >= Math.abs(ty - sy)
  if (horizontal) {
    const midX = (s1.x + t1.x) / 2
    return { x: midX, y: (s1.y + t1.y) / 2 }
  }
  const midY = (s1.y + t1.y) / 2
  return { x: (s1.x + t1.x) / 2, y: midY }
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

function smoothstepPath(sx: number, sy: number, sDir: Dir, tx: number, ty: number, tDir: Dir): WirePathResult {
  const pts = smoothstepElbowPoints(sx, sy, sDir, tx, ty, tDir)
  return { d: roundedPolylinePath(pts), mid: smoothstepMid(sx, sy, sDir, tx, ty, tDir) }
}

// ── Entry point ───────────────────────────────────────────────────────
export function wirePath(
  sx: number, sy: number, sDir: Dir,
  tx: number, ty: number, tDir: Dir,
  style: EdgeStyle,
): WirePathResult {
  if (style === 'bezier') return bezierPath(sx, sy, sDir, tx, ty, tDir)
  if (style === 'smoothstep') return smoothstepPath(sx, sy, sDir, tx, ty, tDir)
  return straightPath(sx, sy, tx, ty)
}
