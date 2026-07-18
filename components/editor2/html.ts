// NeSyCat Semiotics — Export to HTML (a self-contained, embeddable SVG
// snippet a website can drop straight into its markup and have it render,
// no editor/React/KaTeX runtime required).
//
// Reuses tikz.ts's buildDrawCmds — the SAME geometry pass (form/point
// positions, rotation, colors, opacity) that backs the TikZ exporter — so
// this never drifts from what the canvas or the TikZ export show. Only the
// final backend differs: SVG needs no y-flip (SVG is already Y-down, same
// as flow space) and no px->cm conversion — raw px are valid SVG user units.
//
// KNOWN LIMITATION: names/labels render as plain SVG <text>, not full
// KaTeX-rendered math — embedding real KaTeX output would need the target
// page to also load KaTeX's CSS, which a drop-in snippet can't guarantee.
// Good enough for simple identifiers/short expressions; not a LaTeX
// renderer. (Flagged as a v1 tradeoff, not silently swept under the rug.)

import { buildDrawCmds, cmdVecs, SHARE_BASE, type DrawCmd } from './tikz'
import { toRgbTriple } from './color'
import { encodeDiagramToFragment } from './share'
import type { Diagram, Color } from './types'

const INK = '#111111' // theme.ts's text.ink — see tikz.ts's INK constant for why this isn't a Diagram Color
const PAD = 12 // px margin around the diagram's bounding box

function colorRef(c: Color | 'black' | 'ink' | undefined): string {
  if (c === undefined || c === 'black') return 'black'
  if (c === 'ink') return INK
  return `rgb(${toRgbTriple(c)})`
}

// tikz.ts's mathWrap always wraps names as `$text$` for TikZ's own math
// mode — undo that single wrapping layer for plain-text SVG rendering (a
// literal `$` either side would otherwise show up in the output).
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

const ANCHOR_MAP: Record<string, string> = { east: 'start', west: 'end', north: 'middle', south: 'middle' }

function emitCmd(cmd: DrawCmd): string {
  switch (cmd.kind) {
    case 'polygon': {
      const pts = cmd.pts.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
      const fillAttr = cmd.fillColor
        ? ` fill="${colorRef(cmd.fillColor)}" fill-opacity="${cmd.fillOpacity}"`
        : ' fill="none"'
      return `<polygon points="${pts}"${fillAttr} stroke="${colorRef(cmd.strokeColor)}" stroke-width="${cmd.strokeWidthPt}"/>`
    }
    case 'circle': {
      const fillAttr = cmd.fillColor ? ` fill="${colorRef(cmd.fillColor)}" fill-opacity="${cmd.fillOpacity}"` : ' fill="none"'
      const strokeAttr = cmd.strokeColor ? ` stroke="${colorRef(cmd.strokeColor)}" stroke-width="${cmd.strokeWidthPt ?? 1.5}"` : ''
      return `<circle cx="${round(cmd.center.x)}" cy="${round(cmd.center.y)}" r="${round(cmd.radiusPx)}"${fillAttr}${strokeAttr}/>`
    }
    case 'dot':
      return `<circle cx="${round(cmd.center.x)}" cy="${round(cmd.center.y)}" r="${round(cmd.radiusPx)}" fill="${colorRef(cmd.fillColor)}"/>`
    case 'pointDot':
      // Fixed small px radius (unlike TikZ's fixed-pt dot) — a plain, always-
      // visible quiver-style point glyph regardless of the diagram's scale.
      return `<circle cx="${round(cmd.pos.x)}" cy="${round(cmd.pos.y)}" r="4" fill="${colorRef(cmd.color)}"/>`
    case 'pointCircle':
      return `<circle cx="${round(cmd.pos.x)}" cy="${round(cmd.pos.y)}" r="${round(cmd.radiusPx)}" fill="none" stroke="${colorRef(cmd.color)}" stroke-width="1.2"/>`
    case 'pointPolygon': {
      const pts = cmd.pts.map((p) => `${round(p.x)},${round(p.y)}`).join(' ')
      return `<polygon points="${pts}" fill="none" stroke="${colorRef(cmd.color)}" stroke-width="1.2"/>`
    }
    case 'pointLine':
      return `<line x1="${round(cmd.from.x)}" y1="${round(cmd.from.y)}" x2="${round(cmd.to.x)}" y2="${round(cmd.to.y)}" stroke="${colorRef(cmd.color)}" stroke-width="1.2"/>`
    case 'line':
      return `<line x1="${round(cmd.from.x)}" y1="${round(cmd.from.y)}" x2="${round(cmd.to.x)}" y2="${round(cmd.to.y)}" stroke="${colorRef(cmd.color)}" stroke-width="1.5"/>`
    case 'label': {
      const anchor = cmd.anchor ? (ANCHOR_MAP[cmd.anchor] ?? 'middle') : 'middle'
      return `<text x="${round(cmd.at.x)}" y="${round(cmd.at.y)}" text-anchor="${anchor}" dominant-baseline="middle" font-family="ui-monospace, SFMono-Regular, monospace" font-size="14" fill="${INK}">${esc(unwrapMath(cmd.text))}</text>`
    }
  }
}

// The pure, synchronous core — geometry + SVG string generation only, same
// split as tikz.ts's diagramToTikzCore/diagramToTikz for the same reason
// (encodeDiagramToFragment is async/browser-oriented).
export function diagramToHtmlCore(diagram: Diagram, fragment?: string): string {
  const cmds = buildDrawCmds(diagram)
  const allVecs = cmds.flatMap(cmdVecs)
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
