// NeSyCat Semiotics — shared drawing IR.
//
// Pure geometry + a backend-agnostic draw-command list — NO DOM, no React,
// no string emission. This is the ONE geometry pass both export backends
// (export/tikz.ts, export/html.ts) build on, so the two export formats can
// never drift apart on what geometry/color/opacity rules they follow (see
// buildDrawCmds below).
//
// Deliberately re-derives the SAME numbers FormNode.tsx renders on screen
// (same n = geometryFor(form.shape).nodeSize(form)*(scale??1), same
// geom.pointAnchor, same rotation) rather than any independent geometry, so
// the exported picture matches what's actually on the canvas.
//
// Coordinate pipeline:
//   1. Everything is first computed in ABSOLUTE FLOW PX (screen space) —
//      form.position + local node-space geometry (0..n), rotated about the
//      form's own center by exactly the CSS `rotate(deg)` FormNode applies
//      to the whole node div (body + points + names, one rigid unit).
//   2. Backend-specific unit conversion (px -> TikZ cm, or raw px for SVG)
//      happens downstream, in each backend module — not here.

import { geometryFor, pointIdsAt, bodyCentroid, POINT_SIZE, type Body } from '../domain/forms'
import type { Diagram, Form, Point, Shape, Color, EdgeKey } from '../domain/types'

export interface Vec { x: number; y: number }

// ── px-space geometry (pure, synchronous — the testable core) ──────────

function deg2rad(d: number): number {
  return (d * Math.PI) / 180
}

// Rotates `p` about `center` by `deg` — the forward direction of the SAME
// transform Canvas.tsx's unrotateLocal inverts (that function converts a
// clicked/rotated screen point back to pre-rotation local space; this is
// pre-rotation -> rotated screen space). Clockwise, screen/Y-down space,
// matching CSS `transform: rotate(deg)`.
export function rotateAbout(p: Vec, center: Vec, deg: number): Vec {
  if (!deg) return p
  const theta = deg2rad(deg)
  const dx = p.x - center.x
  const dy = p.y - center.y
  const cos = Math.cos(theta)
  const sin = Math.sin(theta)
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos }
}

interface FormLayout {
  form: Form
  n: number
  // The form's rotation pivot, in absolute flow px — its bodyCentroid, NOT
  // its bbox center (see layoutForm below).
  center: Vec
  rotation: number
  // Local node-space (0..n, the SAME frame FormNode.tsx's body/anchors live
  // in before its one CSS rotate()) -> absolute, rotated flow px.
  toAbs: (local: Vec) => Vec
}

function layoutForm(form: Form): FormLayout {
  const geom = geometryFor(form.shape)
  const n = geom.nodeSize(form) * (form.scale ?? 1)
  // The rotation pivot — MUST be the same bodyCentroid FormNode.tsx's CSS
  // transform-origin uses (not the bbox center: a triangle's true centroid
  // sits toward its base), or the exported/TikZ-or-SVG picture visibly
  // disagrees with what's actually on canvas the instant a form rotates.
  // Coincides with the bbox center for square/circle/rhombus/empty, whose
  // centroid IS their bbox center by construction — unchanged for those.
  const [ccx, ccy] = bodyCentroid(geom.body)
  const center = { x: form.position.x + ccx * n, y: form.position.y + ccy * n }
  const rotation = form.rotation ?? 0
  const toAbs = (local: Vec) => rotateAbout({ x: form.position.x + local.x, y: form.position.y + local.y }, center, rotation)
  return { form, n, center, rotation, toAbs }
}

// A form's own rotation pivot (bodyCentroid, not bbox center) in absolute
// flow px — rotation-invariant, a form always rotates about this point.
export function formCenterPx(form: Form): Vec {
  return layoutForm(form).center
}

// Rotated, absolute-px outline of a polygon-bodied form (triangle/square/
// rhombus). null for circle bodies, which FormNode instead renders as a
// plain circle (center + radius n/2 — rotation-invariant, so no vertex list
// is needed for those).
export function formBodyVerticesPx(form: Form): Vec[] | null {
  const geom = geometryFor(form.shape)
  if (geom.body.type !== 'polygon') return null
  const { n, toAbs } = layoutForm(form)
  return geom.body.pointsFrac.map(([fx, fy]) => toAbs({ x: fx * n, y: fy * n }))
}

interface PointPx {
  pos: Vec // absolute, rotated flow px
  local: Vec // the pre-rotation node-space anchor (0..n frame) — glyphs are
  // built as offsets from THIS, then rotated via layout.toAbs, so they turn
  // with the form exactly like FormNode's point glyphs do (nested inside the
  // same single CSS rotate()).
  // The point's own anchor.position ('top'|'right'|'bottom'|'left', from
  // forms.ts's Anchor) — decides which way small glyphs/labels face.
  cardinal: string
  layout: FormLayout
  // Which edge this point sits on, and its 0-based position/count among
  // that edge's OTHER points — carried through so label placement can
  // splay same-edge labels apart (see edgeLabelSplayLocal below). Not used
  // for anything else (glyph/wire placement stays purely anchor-driven).
  edgeKey: EdgeKey
  siblingIndex: number
  siblingCount: number
}

// Every point's absolute, rotated flow-px position (+ the form it sits on),
// keyed by point id — the single source both the Points and Lines sections
// below read from, and what test 4 (a line's \draw endpoints) checks against.
export function pointPositionsPx(diagram: Diagram): Map<string, PointPx> {
  const out = new Map<string, PointPx>()
  for (const form of diagram.forms) {
    const layout = layoutForm(form)
    const geom = geometryFor(form.shape)
    for (const edgeKey of geom.edgeKeys) {
      const ids = pointIdsAt(form, edgeKey)
      ids.forEach((pid, index) => {
        const anchor = geom.pointAnchor(edgeKey, index, ids.length, layout.n)
        const local = { x: anchor.x, y: anchor.y }
        out.set(pid, {
          pos: layout.toAbs(local),
          local,
          cardinal: String(anchor.position),
          layout,
          edgeKey,
          siblingIndex: index,
          siblingCount: ids.length,
        })
      })
    }
  }
  return out
}

// ── Drawing IR — built entirely in px, converted to backend units once ──

export type DrawCmd =
  | { kind: 'polygon'; pts: Vec[]; fillColor?: Color; fillOpacity: number; strokeColor: Color | 'black'; strokeWidthPt: number }
  | { kind: 'circle'; center: Vec; radiusPx: number; fillColor?: Color; fillOpacity: number; strokeColor?: Color | 'black'; strokeWidthPt?: number }
  // Point glyphs — exports ASSUME A WHITE BACKGROUND (unlike the canvas,
  // which keeps a genuinely transparent interior via FormNode's SVG mask):
  // fillColor is always a fully-opaque, already-flattened color — white for
  // an uncolored point, or the point's own/inherited color-tint COMPOSITED
  // over white (see flattenOverWhite) for a colored one. That flattened
  // white/tinted fill is what masks the wire/form-border underneath, so no
  // separate border-gapping or wire-shortening machinery is needed in
  // exports (contrast FormNode.tsx/LineEdge.tsx on canvas). Stroke is always
  // black (backends hardcode it, no field needed here).
  | { kind: 'pointCircle'; pos: Vec; radiusPx: number; fillColor: Color }
  | { kind: 'pointPolygon'; pts: Vec[]; fillColor: Color }
  | { kind: 'line'; from: Vec; to: Vec; color: Color | 'black'; widthPt: number }
  // masked: true for LINE-name and POINT-name labels — canvas masks a
  // canvas-colored band behind those (LineEdge.tsx, PointVisual.tsx) so the
  // wire's dashes don't strike through the text; exports mirror that with an
  // opaque white backing (assumed-white export page — see WHITE below).
  // FORM names are never masked: a white box over a colored form's own tint
  // would look wrong, and canvas doesn't mask them either (FormNode.tsx's
  // name label has no mask sibling).
  | { kind: 'label'; at: Vec; text: string; anchor?: 'east' | 'west' | 'north' | 'south'; masked: boolean }

// Form body: fill 0.18 opacity (theme.node.fillOpacity — see FormNode.tsx's
// BodyView, unselected state; export has no "selected" concept), border
// ALWAYS black regardless of the form's own color (BodyView: `border =
// rgba(0,0,0,bodyOpacity)`, never the accent) and drawn only when
// bodyOpacity > 0 ('empty' forms are invisible carriers — skipped entirely).
const FORM_FILL_OPACITY = 0.18
// Exported: export/tikz.ts's emitCmd falls back to this for a DrawCmd whose
// strokeWidthPt is unset (defensive default for the 'circle' variant's
// optional field — buildFormCmds below always sets it explicitly, but the
// type allows other producers).
export const FORM_STROKE_PT = 0.4
const LINE_STROKE_PT = 0.4
// Point glyphs render at the SAME diameter as canvas — POINT_SIZE
// (domain/forms.ts, also the on-screen glyph/hover/grab-pad size) — so
// canvas <-> TikZ <-> HTML stay in visual lockstep.
const POINT_GLYPH_R = POINT_SIZE / 2
const LABEL_GAP_PX = 16 // matches PointVisual.tsx GAP; clears the POINT_SIZE/2=13px glyph so labels do not touch the form
// Extra along-EDGE nudge for a point's label when it shares its edge with
// other points — see edgeLabelSplayLocal below. Matches FormNode.tsx's own
// SPLAY_PX (kept in sync by hand, same pattern as LABEL_GAP_PX/GAP above).
const SPLAY_PX = 40
// White, as a Color triple — the export glyph's default (uncolored) fill,
// and the backing every colored glyph's tint flattens over (see
// flattenOverWhite). Exports assume a white background (unlike canvas).
const WHITE: Color = [1, 1, 1]

// Composites `fillOpacity`-worth of `color` over an opaque WHITE backing,
// analytically, into a single fully-opaque equivalent color — visually
// identical to layering a translucent tint over a white base (which is what
// PointVisual.tsx's canvas glyph and FormNode.tsx's BodyView do), but as ONE
// flat fill instead of two draw commands, since export assumes a white page
// background anyway.
function flattenOverWhite(color: Color, fillOpacity: number): Color {
  return color.map((c) => (1 - fillOpacity) + fillOpacity * c) as unknown as Color
}

// Small closed-path glyphs for point shapes that aren't circle/empty —
// simplified regular polygons at the POINT_GLYPH_R scale (not a pixel-exact
// port of the SVG sprite in ui/sprite.tsx's ToolbarSprite, which the ticket
// doesn't require).
function glyphLocalPoints(shape: Shape): Array<[number, number]> | null {
  const r = POINT_GLYPH_R
  switch (shape) {
    case 'square':
      return [[-r, -r], [r, -r], [r, r], [-r, r]]
    case 'triangle': // apex right, matching the kind-triangle sprite's orientation
      return [[r, 0], [-r * 0.5, r * 0.866], [-r * 0.5, -r * 0.866]]
    case 'rhombus':
      return [[0, -r], [r, 0], [0, r], [-r, 0]]
    default:
      return null
  }
}

function labelAnchorFor(cardinal: string): { offset: Vec; anchor: 'east' | 'west' | 'north' | 'south' } {
  switch (cardinal) {
    case 'left': return { offset: { x: -LABEL_GAP_PX, y: 0 }, anchor: 'east' } // label sits to the LEFT -> its own east edge touches the point
    case 'right': return { offset: { x: LABEL_GAP_PX, y: 0 }, anchor: 'west' }
    case 'top': return { offset: { x: 0, y: -LABEL_GAP_PX }, anchor: 'south' }
    default: return { offset: { x: 0, y: LABEL_GAP_PX }, anchor: 'north' } // bottom
  }
}

// Mirrors PointVisual.tsx's PointGlyph, adapted for an assumed-white export
// background: outline always black; fill is WHITE for an uncolored point
// (masking whatever's beneath, same visual effect as canvas's genuinely
// transparent interior over the white canvas), or the point's own/inherited
// color flattened over that white backing (flattenOverWhite) — the SAME
// FORM_FILL_OPACITY form bodies use for their own tint, just pre-composited
// into one opaque color instead of two draw commands.
function buildPointCmds(pt: Point, px: PointPx, cmds: DrawCmd[]) {
  const fillColor = pt.color ? flattenOverWhite(pt.color, FORM_FILL_OPACITY) : WHITE
  const local = px.layout.toAbs // local (unrotated, node-space) -> absolute rotated px

  switch (pt.shape) {
    case 'empty':
      break // nothing drawn — the coordinate still exists as a line endpoint
    case 'circle':
      cmds.push({ kind: 'pointCircle', pos: px.pos, radiusPx: POINT_GLYPH_R, fillColor })
      break
    default: {
      const glyph = glyphLocalPoints(pt.shape)
      if (!glyph) break
      const pts = glyph.map(([dx, dy]) => local({ x: px.local.x + dx, y: px.local.y + dy }))
      cmds.push({ kind: 'pointPolygon', pts, fillColor })
      break
    }
  }
}

function buildFormCmds(form: Form, cmds: DrawCmd[]) {
  const geom = geometryFor(form.shape)
  if (geom.bodyOpacity <= 0) return // 'empty' — an invisible carrier, nothing to draw
  const layout = layoutForm(form)
  const body: Body = geom.body

  if (body.type === 'polygon') {
    cmds.push({
      kind: 'polygon',
      pts: formBodyVerticesPx(form)!,
      fillColor: form.color,
      fillOpacity: FORM_FILL_OPACITY,
      strokeColor: 'black',
      strokeWidthPt: FORM_STROKE_PT,
    })
  } else {
    cmds.push({
      kind: 'circle',
      center: layout.center,
      radiusPx: layout.n / 2,
      fillColor: form.color,
      fillOpacity: FORM_FILL_OPACITY,
      strokeColor: 'black',
      strokeWidthPt: FORM_STROKE_PT,
    })
  }

  if (geom.showName) {
    // Centroid, not layout.center (bbox center) — a triangle's centroid sits
    // toward its base, not its bounding-box middle (see domain/forms.ts's
    // bodyCentroid, the SAME helper FormNode.tsx's canvas label uses). The
    // centroid is in local node-space fractions; run it through the form's
    // own rotation via layout.toAbs, same as every other local point here.
    // Circle/'empty' bodies: bodyCentroid returns [0.5, 0.5], which toAbs
    // maps to exactly layout.center — unchanged from before for those kinds.
    const [cfx, cfy] = bodyCentroid(body)
    const labelAt = layout.toAbs({ x: cfx * layout.n, y: cfy * layout.n })
    cmds.push({ kind: 'label', at: labelAt, text: mathWrap(form.name ?? form.id), masked: false })
  }
}

// Fix for "two named points on the same edge collide" (e.g. a discriminated
// -union triangle's base with 'Article'/'Tutorial'): when a point shares its
// edge with siblings, nudge its label an EXTRA fixed distance along the
// edge's own tangent direction — sign flips by whether this point sits
// before or after its siblings' midpoint index, so adjacent labels grow
// APART instead of stacking on top of each other. A lone point, or the
// exact centre point of an odd-count edge, gets zero bias (unchanged).
//
// Deliberately pure (index, count) + real pointAnchor geometry — NO DOM
// text-width measurement (exports have no DOM) and no dependency on the
// label text itself. The tangent is derived from the edge's own first/last
// sibling anchors (in the SAME pre-rotation local frame buildPointLabelCmd's
// `local + offset` already lives in), so it automatically comes out through
// the SAME toAbs rotation as everything else: a roughly-horizontal edge
// (e.g. this triangle's base at rotation 270, where a normally-vertical
// side becomes horizontal on screen) ends up splaying its labels apart in
// screen-X — which is exactly the collision the ticket describes — while an
// unrotated vertical edge splays in screen-Y, harmlessly (its labels were
// already spaced apart by pointAnchor there).
//
// Mirror EXACTLY in ui/FormNode.tsx's edgeLabelSplay — canvas and exports
// must agree pixel-for-pixel (same rule as LABEL_GAP_PX/GAP above).
function edgeLabelSplayLocal(px: PointPx): Vec {
  const { edgeKey, siblingIndex: index, siblingCount: count, layout } = px
  if (count <= 1) return { x: 0, y: 0 }
  const mid = (count - 1) / 2
  const sign = Math.sign(index - mid)
  if (sign === 0) return { x: 0, y: 0 } // exact centre of an odd-count edge
  const geom = geometryFor(layout.form.shape)
  const start = geom.pointAnchor(edgeKey, 0, count, layout.n)
  const end = geom.pointAnchor(edgeKey, count - 1, count, layout.n)
  const tx = end.x - start.x
  const ty = end.y - start.y
  const len = Math.hypot(tx, ty)
  if (len < 1e-6) return { x: 0, y: 0 } // degenerate edge — no meaningful tangent, no bias
  // Only splay a SCREEN-horizontal edge: there labels extend vertically and long
  // ones collide in x, so nudging them apart along the edge helps. On a
  // screen-vertical edge labels extend horizontally and already stack with their
  // own gap — splaying along it just shoves them off their ports. Judge
  // orientation AFTER rotation (toAbs), so a rotated triangle base still counts.
  const sAbs = layout.toAbs({ x: start.x, y: start.y })
  const eAbs = layout.toAbs({ x: end.x, y: end.y })
  if (Math.abs(eAbs.y - sAbs.y) > Math.abs(eAbs.x - sAbs.x)) return { x: 0, y: 0 }
  return { x: (sign * SPLAY_PX * tx) / len, y: (sign * SPLAY_PX * ty) / len }
}

// Points render a label ONLY when explicitly named (unlike forms/lines,
// which always show a name-or-id label on screen) — an un-named point's
// auto id (P1, P2, …) would clutter an exported figure with noise nobody
// asked for. See the ticket's "Named points: small label node offset
// outward" — deliberately narrower than forms/lines.
function buildPointLabelCmd(pt: Point, px: PointPx): DrawCmd | null {
  if (!pt.name) return null
  const { offset, anchor } = labelAnchorFor(px.cardinal)
  const splay = edgeLabelSplayLocal(px)
  const at = px.layout.toAbs({ x: px.local.x + offset.x + splay.x, y: px.local.y + offset.y + splay.y })
  return { kind: 'label', at, text: mathWrap(pt.name), anchor, masked: true }
}

// Wires are drawn full-length, endpoint to endpoint — no gap/shortening
// needed in exports (unlike canvas's LineEdge): a terminating point's own
// glyph fill is opaque (WHITE, or a color flattened over white — see
// buildPointCmds) and is emitted AFTER lines in buildDrawCmds below, so it
// simply paints over the wire's end. Exports assume a white background.
// Line labels are collected into a SEPARATE array and appended only after
// EVERY line draw command (across the whole diagram, not just this line's
// own segments) — a masked label must paint AFTER every wire it could cross,
// including another segment of the SAME hyperedge that might pass near its
// midpoint. Pushing the label inline (right after its own segment 0 draw, as
// this used to do) left it UNDER later segments/lines drawn afterward, which
// could then strike through its white backing. Collect-then-append is the
// simplest fix that doesn't need per-label crossing detection.
function buildLineCmds(diagram: Diagram, positions: Map<string, PointPx>, cmds: DrawCmd[]) {
  const labelCmds: DrawCmd[] = []
  for (const line of diagram.lines) {
    const src = positions.get(line.source)
    if (!src) continue
    line.targets.forEach((tid) => {
      const tgt = positions.get(tid)
      if (!tgt) return
      cmds.push({ kind: 'line', from: src.pos, to: tgt.pos, color: line.color ?? 'black', widthPt: LINE_STROKE_PT })
      // EVERY branch of a hyperedge carries the line's name (user decision:
      // each branch of a fork shows the wire's type explicitly) — canvas's
      // builtEdges (ui/Canvas.tsx) renders the same per-branch labels.
      if (line.name) {
        const mid = { x: (src.pos.x + tgt.pos.x) / 2, y: (src.pos.y + tgt.pos.y) / 2 }
        labelCmds.push({ kind: 'label', at: mid, text: mathWrap(line.name), masked: true })
      }
    })
  }
  cmds.push(...labelCmds)
}

// Names render through ui/Tex.tsx, which ALWAYS runs katex.renderToString on
// the raw text regardless of `$` delimiters — there is no plain-text mode in
// this editor, every name is math. Mirrored here by always wrapping in
// `$...$` for TikZ's own math-mode rendering (html.ts's SVG backend unwraps
// this single layer back off — see its unwrapMath).
function mathWrap(text: string): string {
  return `$${text}$`
}

// All coordinates a DrawCmd touches — for the bounding box pass (min/max
// must see EVERY position that ends up in the output, including labels, or
// a label could land outside the normalized [0, width] x [0, height] box).
// Exported so both backends can compute their own bounding box the same way.
export function cmdVecs(cmd: DrawCmd): Vec[] {
  switch (cmd.kind) {
    case 'polygon': return cmd.pts
    case 'circle': return [cmd.center]
    case 'pointCircle': return [cmd.pos]
    case 'pointPolygon': return cmd.pts
    case 'line': return [cmd.from, cmd.to]
    case 'label': return [cmd.at]
  }
}

export const SHARE_BASE = 'https://semiotics.nesycat.org/editor'

// The full form+point+line draw-command list, in px — the shared IR both
// export/tikz.ts's diagramToTikzCore and export/html.ts's SVG emitter
// consume, so the two export formats can never drift apart on what
// geometry/color/opacity rules they follow (one geometry pass, two string
// backends).
//
// Order matters: forms, THEN lines, THEN points — later commands paint OVER
// earlier ones, so a point's own opaque glyph fill (buildPointCmds; WHITE or
// a color flattened over white) is what visually masks a wire's end/a form's
// border underneath it, with no separate gap geometry needed (see
// buildLineCmds's own comment).
export function buildDrawCmds(diagram: Diagram): DrawCmd[] {
  const cmds: DrawCmd[] = []
  for (const form of diagram.forms) buildFormCmds(form, cmds)

  const positions = pointPositionsPx(diagram)
  buildLineCmds(diagram, positions, cmds)

  for (const form of diagram.forms) {
    const geom = geometryFor(form.shape)
    for (const edgeKey of geom.edgeKeys) {
      pointIdsAt(form, edgeKey).forEach((pid) => {
        const pt = diagram.points[pid]
        const px = positions.get(pid)
        if (!pt || !px) return
        buildPointCmds(pt, px, cmds)
        const label = buildPointLabelCmd(pt, px)
        if (label) cmds.push(label)
      })
    }
  }

  return cmds
}
