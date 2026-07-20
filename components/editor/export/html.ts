// NeSyCat Semiotics — Export to HTML (a self-contained, embeddable SVG
// snippet a website can drop straight into its markup and have it render,
// no editor/React/KaTeX runtime required).
//
// Reuses ir/geometry-ir.ts's buildDrawCmds — the SAME geometry pass
// (form/point positions, rotation, colors, opacity) that backs the TikZ
// exporter — so this never drifts from what the canvas or the TikZ export
// show. Only the final backend differs: SVG needs no y-flip (SVG is already
// Y-down, same as flow space) and no px->cm conversion — raw px are valid
// SVG user units.
//
// KNOWN LIMITATION: names/labels render as plain SVG <text>, not full
// KaTeX-rendered math — embedding real KaTeX output would need the target
// page to also load KaTeX's CSS, which a drop-in snippet can't guarantee.
// Good enough for simple identifiers/short expressions; not a LaTeX
// renderer. (Flagged as a v1 tradeoff, not silently swept under the rug.)

import { buildDrawCmds, cmdVecs, SHARE_BASE, type DrawCmd } from '../ir/geometry-ir'
import { toRgbTriple } from '../domain/color'
import { encodeDiagramToFragment } from '../persist/share'
import type { Diagram, Color } from '../domain/types'

const INK = '#111111' // theme.ts's text.ink — used for the plain-text SVG name/point labels
const PAD = 12 // px margin around the diagram's bounding box
// FormNode.tsx renders body borders at 1.5px — NOT DrawCmd.strokeWidthPt
// (0.4, a TikZ *pt* value for the cm-scaled backend), which as SVG user
// units would draw a hairline and sit inconsistently beside the 1.5px wires.
const FORM_STROKE = 1.5
// Label extent estimate for the bounding box: 14px ui-monospace runs ≈8.4px
// per glyph; half that height above/below the anchored midline.
const LABEL_CHAR_W = 8.4
const LABEL_HALF_H = 9

function colorRef(c: Color | 'black' | undefined): string {
  if (c === undefined || c === 'black') return 'black'
  return `rgb(${toRgbTriple(c)})`
}

// ir/geometry-ir.ts's mathWrap always wraps names as `$text$` for TikZ's own
// math mode — undo that single wrapping layer for plain-text SVG rendering
// (a literal `$` either side would otherwise show up in the output).
function unwrapMath(text: string): string {
  return text.length >= 2 && text.startsWith('$') && text.endsWith('$') ? text.slice(1, -1) : text
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function round(n: number): number {
  if (!Number.isFinite(n)) return 0
  return Math.round(n * 100) / 100
}

// TikZ anchors name the side of the TEXT that touches the coordinate —
// anchor=east puts the text's east edge there, so the text extends LEFT.
// SVG's text-anchor names where the text STARTS relative to x. The two are
// therefore inverses: east -> 'end' (text ends at x), west -> 'start'.
const ANCHOR_MAP: Record<string, string> = { east: 'end', west: 'start', north: 'middle', south: 'middle' }

function emitCmd(cmd: DrawCmd): string {
  switch (cmd.kind) {
    case 'polygon': {
      const pts = cmd.pts.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
      const fillAttr = cmd.fillColor
        ? ` fill="${colorRef(cmd.fillColor)}" fill-opacity="${cmd.fillOpacity}"`
        : ' fill="none"'
      return `<polygon points="${pts}"${fillAttr} stroke="${colorRef(cmd.strokeColor)}" stroke-width="${FORM_STROKE}"/>`
    }
    case 'circle': {
      const fillAttr = cmd.fillColor ? ` fill="${colorRef(cmd.fillColor)}" fill-opacity="${cmd.fillOpacity}"` : ' fill="none"'
      const strokeAttr = cmd.strokeColor ? ` stroke="${colorRef(cmd.strokeColor)}" stroke-width="${FORM_STROKE}"` : ''
      return `<circle cx="${round(cmd.center.x)}" cy="${round(cmd.center.y)}" r="${round(cmd.radiusPx)}"${fillAttr}${strokeAttr}/>`
    }
    case 'pointCircle':
      // fillColor is always set (white, or a color flattened over white —
      // see geometry-ir.ts's buildPointCmds) and fully opaque — the glyph
      // masks whatever's underneath on the assumed-white export page.
      return `<circle cx="${round(cmd.pos.x)}" cy="${round(cmd.pos.y)}" r="${round(cmd.radiusPx)}" fill="${colorRef(cmd.fillColor)}" stroke="black" stroke-width="1.5"/>`
    case 'pointPolygon': {
      const pts = cmd.pts.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
      return `<polygon points="${pts}" fill="${colorRef(cmd.fillColor)}" stroke="black" stroke-width="1.5"/>`
    }
    case 'line':
      return `<line x1="${round(cmd.from.x)}" y1="${round(cmd.from.y)}" x2="${round(cmd.to.x)}" y2="${round(cmd.to.y)}" stroke="${colorRef(cmd.color)}" stroke-width="1.5"/>`
    case 'label': {
      const anchor = cmd.anchor ? (ANCHOR_MAP[cmd.anchor] ?? 'middle') : 'middle'
      return `<text x="${round(cmd.at.x)}" y="${round(cmd.at.y)}" text-anchor="${anchor}" dominant-baseline="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="14" fill="${INK}">${esc(unwrapMath(cmd.text))}</text>`
    }
  }
}

// Extent-aware bounding points. cmdVecs alone is center-only for round
// shapes — fine for the TikZ backend (TikZ re-measures every drawn path
// when it computes the picture's own bbox) but an SVG viewBox CLIPS, so a
// circle-bodied form at the diagram's edge would lose up to r−PAD of rim.
// Pad circles by their radius and labels by a monospace-glyph estimate.
function cmdBoundsVecs(cmd: DrawCmd): { x: number; y: number }[] {
  switch (cmd.kind) {
    case 'circle': {
      const { center, radiusPx: r } = cmd
      return [{ x: center.x - r, y: center.y - r }, { x: center.x + r, y: center.y + r }]
    }
    case 'pointCircle': {
      const { pos, radiusPx: r } = cmd
      return [{ x: pos.x - r, y: pos.y - r }, { x: pos.x + r, y: pos.y + r }]
    }
    case 'label': {
      // Anchor-aware horizontal extent, mirroring ANCHOR_MAP: 'east' means
      // the text ENDS at the point (grows leftward), 'west' starts there
      // (grows rightward), default middle both ways.
      const w = unwrapMath(cmd.text).length * LABEL_CHAR_W
      const left = cmd.anchor === 'west' ? 0 : cmd.anchor === 'east' ? w : w / 2
      const right = cmd.anchor === 'east' ? 0 : cmd.anchor === 'west' ? w : w / 2
      return [
        { x: cmd.at.x - left, y: cmd.at.y - LABEL_HALF_H },
        { x: cmd.at.x + right, y: cmd.at.y + LABEL_HALF_H },
      ]
    }
    default:
      return cmdVecs(cmd)
  }
}

// The pure, synchronous core — geometry + SVG string generation only, same
// split as tikz.ts's diagramToTikzCore/diagramToTikz for the same reason
// (encodeDiagramToFragment is async/browser-oriented).
export function diagramToHtmlCore(diagram: Diagram, fragment?: string): string {
  const cmds = buildDrawCmds(diagram)
  const allVecs = cmds.flatMap(cmdBoundsVecs)
  const minX = allVecs.length ? Math.min(...allVecs.map((v) => v.x)) : 0
  const minY = allVecs.length ? Math.min(...allVecs.map((v) => v.y)) : 0
  const maxX = allVecs.length ? Math.max(...allVecs.map((v) => v.x)) : 0
  const maxY = allVecs.length ? Math.max(...allVecs.map((v) => v.y)) : 0
  const w = Math.max(1, maxX - minX + PAD * 2)
  const h = Math.max(1, maxY - minY + PAD * 2)

  const body = cmds.map(emitCmd).join('\n  ')
  const comment = fragment ? `<!-- ${SHARE_BASE}#${fragment} -->\n` : ''

  return `${comment}<!-- Exported from NeSyCat Semiotics -->
<svg xmlns="http://www.w3.org/2000/svg" viewBox="${round(minX - PAD)} ${round(minY - PAD)} ${round(w)} ${round(h)}" width="${round(w)}" height="${round(h)}">
  ${body}
</svg>`
}

export async function diagramToHtml(diagram: Diagram): Promise<string> {
  const fragment = await encodeDiagramToFragment(diagram)
  return diagramToHtmlCore(diagram, fragment)
}
