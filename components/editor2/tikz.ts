// NeSyCat Semiotics — Export to LaTeX/TikZ.
//
// Pure geometry + string generation — NO DOM, no React, so the core runs in
// plain node (see _tests/file/tikz.test.ts, `npx tsx _tests/file/tikz.test.ts`).
// Deliberately re-derives the SAME numbers FormNode.tsx renders on screen
// (same n = geometryFor(kind).nodeSize(form)*(scale??1), same
// geom.pointAnchor, same rotation) rather than any independent geometry, so
// the exported picture matches what's actually on the canvas.
//
// Coordinate pipeline:
//   1. Everything is first computed in ABSOLUTE FLOW PX (screen space) —
//      form.position + local node-space geometry (0..n), rotated about the
//      form's own center by exactly the CSS `rotate(deg)` FormNode applies
//      to the whole node div (body + points + names, one rigid unit).
//   2. px -> TikZ cm, once, at the very end: x_cm = (x - minX) / 100,
//      y_cm = (maxY - y) / 100 — a y-flip (flow space is Y-down, TikZ/LaTeX
//      is Y-up) plus normalizing the whole picture to start at the origin.
//      100px = 1cm, chosen so grid.ts's 50px pitch lands on clean 0.5cm
//      multiples. Bare TikZ coordinate numbers are already centimeters (a
//      tikzpicture's default unit vectors are 1cm/1cm) — no `cm` suffix
//      needed.

import { geometryFor, pointIdsAt, type Body } from './forms'
import { encodeDiagramToFragment } from './share'
import type { Diagram, Form, Point, PointShape, Color } from './types'

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
  center: Vec
  rotation: number
  // Local node-space (0..n, the SAME frame FormNode.tsx's body/anchors live
  // in before its one CSS rotate()) -> absolute, rotated flow px.
  toAbs: (local: Vec) => Vec
}

function layoutForm(form: Form): FormLayout {
  const geom = geometryFor(form.kind)
  const n = geom.nodeSize(form) * (form.scale ?? 1)
  const center = { x: form.position.x + n / 2, y: form.position.y + n / 2 }
  const rotation = form.rotation ?? 0
  const toAbs = (local: Vec) => rotateAbout({ x: form.position.x + local.x, y: form.position.y + local.y }, center, rotation)
  return { form, n, center, rotation, toAbs }
}

// A form's own center in absolute flow px (rotation-invariant — a form
// always rotates about its own center).
export function formCenterPx(form: Form): Vec {
  return layoutForm(form).center
}

// Rotated, absolute-px outline of a polygon-bodied form (triangle/square/
// rhombus). null for circle/dot bodies, which FormNode instead renders as a
// plain circle (center + radius n/2 — rotation-invariant, so no vertex list
// is needed for those).
export function formBodyVerticesPx(form: Form): Vec[] | null {
  const geom = geometryFor(form.kind)
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
}

// Every point's absolute, rotated flow-px position (+ the form it sits on),
// keyed by point id — the single source both the Points and Lines sections
// below read from, and what test 4 (a line's \draw endpoints) checks against.
export function pointPositionsPx(diagram: Diagram): Map<string, PointPx> {
  const out = new Map<string, PointPx>()
  for (const form of diagram.forms) {
    const layout = layoutForm(form)
    const geom = geometryFor(form.kind)
    for (const edgeKey of geom.edgeKeys) {
      const ids = pointIdsAt(form, edgeKey)
      ids.forEach((pid, index) => {
        const anchor = geom.pointAnchor(edgeKey, index, ids.length, layout.n)
        const local = { x: anchor.x, y: anchor.y }
        out.set(pid, { pos: layout.toAbs(local), local, cardinal: String(anchor.position), layout })
      })
    }
  }
  return out
}

// ── Drawing IR — built entirely in px, converted to cm once at the end ──

export type DrawCmd =
  | { kind: 'polygon'; pts: Vec[]; fillColor?: Color; fillOpacity: number; strokeColor: Color | 'black'; strokeWidthPt: number }
  | { kind: 'circle'; center: Vec; radiusPx: number; fillColor?: Color; fillOpacity: number; strokeColor?: Color | 'black'; strokeWidthPt?: number }
  | { kind: 'dot'; center: Vec; radiusPx: number; fillColor: Color | 'ink' }
  | { kind: 'pointDot'; pos: Vec; color: Color | 'black' } // quiver-style fixed-size point glyph (2.5pt, NOT scaled by px->cm)
  | { kind: 'pointCircle'; pos: Vec; radiusPx: number; color: Color | 'black' }
  | { kind: 'pointPolygon'; pts: Vec[]; color: Color | 'black' }
  | { kind: 'pointLine'; from: Vec; to: Vec; color: Color | 'black' }
  | { kind: 'line'; from: Vec; to: Vec; color: Color | 'black'; widthPt: number }
  | { kind: 'label'; at: Vec; text: string; anchor?: 'east' | 'west' | 'north' | 'south' }

// Form body: fill 0.18 opacity (theme.node.fillOpacity — see FormNode.tsx's
// BodyView, unselected state; export has no "selected" concept), border
// ALWAYS black regardless of the form's own color (BodyView: `border =
// rgba(0,0,0,bodyOpacity)`, never the accent) and drawn only when
// bodyOpacity > 0 ('empty' forms are invisible carriers — skipped entirely).
const FORM_FILL_OPACITY = 0.18
const FORM_STROKE_PT = 0.4
const LINE_STROKE_PT = 0.4
// ~11px across (~0.11cm) — the ticket's reference size for point glyphs
// other than the quiver-style fixed-size dot.
const POINT_GLYPH_PX = 11
const POINT_GLYPH_R = POINT_GLYPH_PX / 2
const LABEL_GAP_PX = 11 // matches FormNode.tsx's point-label GAP

// Small closed-path glyphs for point shapes that aren't circle/point/line/
// empty — simplified regular polygons at the ticket's ~11px-across scale
// (not a pixel-exact port of the SVG sprite in Canvas.tsx's ToolbarSprite,
// which the ticket doesn't require).
function glyphLocalPoints(shape: PointShape): Array<[number, number]> | null {
  const r = POINT_GLYPH_R
  switch (shape) {
    case 'square':
      return [[-r, -r], [r, -r], [r, r], [-r, r]]
    case 'triangle': // apex right, matching the kind-triangle sprite's orientation
      return [[r, 0], [-r * 0.5, r * 0.866], [-r * 0.5, -r * 0.866]]
    case 'rhombus':
      return [[0, -r], [r, 0], [0, r], [-r, 0]]
    case 'pentagon':
    case 'hexagon': {
      const n = shape === 'pentagon' ? 5 : 6
      const start = -Math.PI / 2 // first vertex pointing up
      return Array.from({ length: n }, (_, i) => {
        const theta = start + (i / n) * 2 * Math.PI
        return [r * Math.cos(theta), r * Math.sin(theta)] as [number, number]
      })
    }
    default:
      return null
  }
}

// Which way a small glyph/segment/label should face, derived from the
// point's own anchor cardinal — 'top'/'bottom' anchors sit on a
// horizontally-running edge, so their tangent (and hence a 'line' shape's
// segment) runs horizontal; 'left'/'right' anchors sit on a vertically-
// running edge, tangent runs vertical.
function tangentAxis(cardinal: string): 'horizontal' | 'vertical' {
  return cardinal === 'top' || cardinal === 'bottom' ? 'horizontal' : 'vertical'
}

function labelAnchorFor(cardinal: string): { offset: Vec; anchor: 'east' | 'west' | 'north' | 'south' } {
  switch (cardinal) {
    case 'left': return { offset: { x: -LABEL_GAP_PX, y: 0 }, anchor: 'east' } // label sits to the LEFT -> its own east edge touches the point
    case 'right': return { offset: { x: LABEL_GAP_PX, y: 0 }, anchor: 'west' }
    case 'top': return { offset: { x: 0, y: -LABEL_GAP_PX }, anchor: 'south' }
    default: return { offset: { x: 0, y: LABEL_GAP_PX }, anchor: 'north' } // bottom
  }
}

function buildPointCmds(pt: Point, px: PointPx, cmds: DrawCmd[]) {
  const color: Color | 'black' = pt.color ?? 'black'
  const local = px.layout.toAbs // local (unrotated, node-space) -> absolute rotated px

  switch (pt.shape) {
    case 'empty':
      break // nothing drawn — the coordinate still exists as a line endpoint
    case 'point':
      cmds.push({ kind: 'pointDot', pos: px.pos, color })
      break
    case 'circle':
      cmds.push({ kind: 'pointCircle', pos: px.pos, radiusPx: POINT_GLYPH_R, color })
      break
    case 'line': {
      // Segment endpoints as LOCAL offsets from the point's own local anchor
      // (so rotating the form rotates the segment's facing with it, same as
      // every other point glyph — built in the form's local frame, then
      // carried through the SAME toAbs rotation).
      const axis = tangentAxis(px.cardinal)
      const half = POINT_GLYPH_R
      const a = axis === 'horizontal' ? { x: px.local.x - half, y: px.local.y } : { x: px.local.x, y: px.local.y - half }
      const b = axis === 'horizontal' ? { x: px.local.x + half, y: px.local.y } : { x: px.local.x, y: px.local.y + half }
      cmds.push({ kind: 'pointLine', from: local(a), to: local(b), color })
      break
    }
    default: {
      const glyph = glyphLocalPoints(pt.shape)
      if (!glyph) break
      const pts = glyph.map(([dx, dy]) => local({ x: px.local.x + dx, y: px.local.y + dy }))
      cmds.push({ kind: 'pointPolygon', pts, color })
      break
    }
  }
}

function buildFormCmds(form: Form, cmds: DrawCmd[]) {
  const geom = geometryFor(form.kind)
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
  } else if (body.type === 'circle') {
    cmds.push({
      kind: 'circle',
      center: layout.center,
      radiusPx: layout.n / 2,
      fillColor: form.color,
      fillOpacity: FORM_FILL_OPACITY,
      strokeColor: 'black',
      strokeWidthPt: FORM_STROKE_PT,
    })
  } else {
    // 'dot' — the point-kind form's own body: solid fill, no stroke (BodyView).
    cmds.push({ kind: 'dot', center: layout.center, radiusPx: layout.n / 2, fillColor: form.color ?? 'ink' })
  }

  if (geom.showName) {
    cmds.push({ kind: 'label', at: layout.center, text: mathWrap(form.name ?? form.id) })
  }
}

// Points render a label ONLY when explicitly named (unlike forms/lines,
// which always show a name-or-id label on screen) — an un-named point's
// auto id (P1, P2, …) would clutter an exported figure with noise nobody
// asked for. See the ticket's "Named points: small label node offset
// outward" — deliberately narrower than forms/lines.
function buildPointLabelCmd(pt: Point, px: PointPx): DrawCmd | null {
  if (!pt.name) return null
  const { offset, anchor } = labelAnchorFor(px.cardinal)
  const at = px.layout.toAbs({ x: px.local.x + offset.x, y: px.local.y + offset.y })
  return { kind: 'label', at, text: mathWrap(pt.name), anchor }
}

function buildLineCmds(diagram: Diagram, positions: Map<string, PointPx>, cmds: DrawCmd[]) {
  for (const line of diagram.lines) {
    const src = positions.get(line.source)
    if (!src) continue
    line.targets.forEach((tid, i) => {
      const tgt = positions.get(tid)
      if (!tgt) return
      cmds.push({ kind: 'line', from: src.pos, to: tgt.pos, color: line.color ?? 'black', widthPt: LINE_STROKE_PT })
      if (i === 0 && line.name) {
        const mid = { x: (src.pos.x + tgt.pos.x) / 2, y: (src.pos.y + tgt.pos.y) / 2 }
        cmds.push({ kind: 'label', at: mid, text: mathWrap(line.name) })
      }
    })
  }
}

// Names render through Tex.tsx (components/editor2/Tex.tsx), which ALWAYS
// runs katex.renderToString on the raw text regardless of `$` delimiters —
// there is no plain-text mode in this editor, every name is math. Mirrored
// here by always wrapping in `$...$` for TikZ's own math-mode rendering.
function mathWrap(text: string): string {
  return `$${text}$`
}

// ── px -> cm + string emission ──────────────────────────────────────────

function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0' // guards against NaN/undefined ever reaching the output
  const rounded = Math.round(n * 1000) / 1000
  let s = rounded.toFixed(3).replace(/0+$/, '').replace(/\.$/, '')
  if (s === '' || s === '-0') s = '0'
  return s
}

function coord(v: Vec, minX: number, maxY: number): string {
  return `${fmt((v.x - minX) / 100)},${fmt((maxY - v.y) / 100)}`
}

// Any length (radius, offset) in px -> the same 100px=1cm scale, as a bare
// delta (no min/max normalization — lengths aren't positions).
function lenCm(px: number): string {
  return fmt(px / 100)
}

class ColorRegistry {
  private names = new Map<string, string>()
  private lines: string[] = []
  key(c: Color): string {
    const k = c.map((ch) => fmt(ch)).join(',')
    const existing = this.names.get(k)
    if (existing) return existing
    const name = `nesyColor${this.names.size}`
    this.names.set(k, name)
    this.lines.push(`\\definecolor{${name}}{rgb}{${k}}`)
    return name
  }
  definitions(): string[] {
    return this.lines
  }
}

// theme.ts's text.ink (#111111) — FormNode's fallback fill for an uncolored
// 'dot' body (the point-kind form). Not a Diagram Color; a fixed constant
// resolved through the SAME registry as any other color so it emits one
// consistent \definecolor instead of a one-off hex literal.
const INK: Color = [0x11 / 255, 0x11 / 255, 0x11 / 255]

function tikzColorRef(c: Color | 'black' | 'ink' | undefined, registry: ColorRegistry): string {
  if (c === undefined || c === 'black') return 'black'
  if (c === 'ink') return registry.key(INK)
  return registry.key(c)
}

function emitCmd(cmd: DrawCmd, registry: ColorRegistry, minX: number, maxY: number): string {
  const c = (v: Vec) => coord(v, minX, maxY)
  switch (cmd.kind) {
    case 'polygon': {
      const path = cmd.pts.map((p) => `(${c(p)})`).join(' -- ')
      const stroke = tikzColorRef(cmd.strokeColor, registry)
      if (cmd.fillColor) {
        const fill = tikzColorRef(cmd.fillColor, registry)
        return `\\filldraw[fill=${fill}, fill opacity=${fmt(cmd.fillOpacity)}, draw=${stroke}, line width=${cmd.strokeWidthPt}pt] ${path} -- cycle;`
      }
      return `\\draw[draw=${stroke}, line width=${cmd.strokeWidthPt}pt] ${path} -- cycle;`
    }
    case 'circle': {
      const stroke = cmd.strokeColor ? tikzColorRef(cmd.strokeColor, registry) : null
      const r = lenCm(cmd.radiusPx)
      if (cmd.fillColor) {
        const fill = tikzColorRef(cmd.fillColor, registry)
        return `\\filldraw[fill=${fill}, fill opacity=${fmt(cmd.fillOpacity)}, draw=${stroke ?? 'black'}, line width=${cmd.strokeWidthPt ?? FORM_STROKE_PT}pt] (${c(cmd.center)}) circle (${r});`
      }
      return `\\draw[draw=${stroke ?? 'black'}, line width=${cmd.strokeWidthPt ?? FORM_STROKE_PT}pt] (${c(cmd.center)}) circle (${r});`
    }
    case 'dot': {
      const fill = tikzColorRef(cmd.fillColor, registry)
      return `\\fill[${fill}] (${c(cmd.center)}) circle (${lenCm(cmd.radiusPx)});`
    }
    case 'pointDot': {
      const color = tikzColorRef(cmd.color, registry)
      return `\\fill[${color}] (${c(cmd.pos)}) circle (2.5pt);` // fixed quiver-style size — NOT scaled by the px->cm mapping
    }
    case 'pointCircle': {
      const color = tikzColorRef(cmd.color, registry)
      return `\\draw[${color}] (${c(cmd.pos)}) circle (${lenCm(cmd.radiusPx)});`
    }
    case 'pointPolygon': {
      const color = tikzColorRef(cmd.color, registry)
      const path = cmd.pts.map((p) => `(${c(p)})`).join(' -- ')
      return `\\draw[${color}] ${path} -- cycle;`
    }
    case 'pointLine': {
      const color = tikzColorRef(cmd.color, registry)
      return `\\draw[${color}] (${c(cmd.from)}) -- (${c(cmd.to)});`
    }
    case 'line': {
      const color = tikzColorRef(cmd.color, registry)
      return `\\draw[${color}, line width=${cmd.widthPt}pt] (${c(cmd.from)}) -- (${c(cmd.to)});`
    }
    case 'label': {
      const opt = cmd.anchor ? `[anchor=${cmd.anchor}] ` : ' '
      return `\\node${opt}at (${c(cmd.at)}) {${cmd.text}};`
    }
  }
}

// All coordinates a DrawCmd touches — for the bounding box pass (min/max
// must see EVERY position that ends up in the output, including labels, or
// a label could land outside the normalized [0, width] x [0, height] box).
// Exported so other backends (html.ts) sharing this IR can compute their own
// bounding box the same way.
export function cmdVecs(cmd: DrawCmd): Vec[] {
  switch (cmd.kind) {
    case 'polygon': return cmd.pts
    case 'circle': return [cmd.center]
    case 'dot': return [cmd.center]
    case 'pointDot': return [cmd.pos]
    case 'pointCircle': return [cmd.pos]
    case 'pointPolygon': return cmd.pts
    case 'pointLine': return [cmd.from, cmd.to]
    case 'line': return [cmd.from, cmd.to]
    case 'label': return [cmd.at]
  }
}

export const SHARE_BASE = 'https://semiotics.nesycat.org/editor'

// The full form+point+line draw-command list, in px — the shared IR both
// diagramToTikzCore (below) and html.ts's SVG emitter consume, so the two
// export formats can never drift apart on what geometry/color/opacity rules
// they follow (one geometry pass, two string backends).
export function buildDrawCmds(diagram: Diagram): DrawCmd[] {
  const cmds: DrawCmd[] = []
  for (const form of diagram.forms) buildFormCmds(form, cmds)

  const positions = pointPositionsPx(diagram)
  for (const form of diagram.forms) {
    const geom = geometryFor(form.kind)
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

  buildLineCmds(diagram, positions, cmds)
  return cmds
}

// The pure, synchronous core — geometry + string generation only. Takes an
// already-computed share fragment (or none, if the header line should be
// omitted) so it never needs the browser-only compression APIs
// encodeDiagramToFragment relies on (see share.ts). This is what
// _tests/file/tikz.test.ts calls directly.
export function diagramToTikzCore(diagram: Diagram, fragment?: string): string {
  const cmds = buildDrawCmds(diagram)
  const allVecs = cmds.flatMap(cmdVecs)
  const minX = allVecs.length ? Math.min(...allVecs.map((v) => v.x)) : 0
  const maxY = allVecs.length ? Math.max(...allVecs.map((v) => v.y)) : 0

  const registry = new ColorRegistry()
  const body = cmds.map((cmd) => emitCmd(cmd, registry, minX, maxY))

  const header = [
    '% Exported from NeSyCat Semiotics',
    fragment ? `% ${SHARE_BASE}#${fragment}` : null,
  ].filter((l): l is string => l !== null)

  return [
    ...header,
    '\\begin{tikzpicture}',
    ...registry.definitions().map((l) => `  ${l}`),
    ...body.map((l) => `  ${l}`),
    '\\end{tikzpicture}',
  ].join('\n')
}

// Async wrapper — pulls in the quiver-style re-import link via share.ts's
// encodeDiagramToFragment, which is genuinely async (CompressionStream) and
// browser-oriented (though it also runs fine under modern node, which is why
// the test script can exercise this path too, not just diagramToTikzCore).
export async function diagramToTikz(diagram: Diagram): Promise<string> {
  const fragment = await encodeDiagramToFragment(diagram)
  return diagramToTikzCore(diagram, fragment)
}
