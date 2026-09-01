// NeSyCat Semiotics — Export to LaTeX/TikZ.
//
// String generation only — the geometry pass (form/point positions,
// rotation, colors, opacity, the DrawCmd IR) lives in ir/geometry-ir.ts,
// shared with export/html.ts so the two export formats can never drift
// apart on what they draw. This module's job is turning that IR into TikZ
// source: px -> cm conversion, color registration, and \draw/\filldraw/\node
// emission.
//
// Pure string generation — NO DOM, no React, so it runs in plain node (see
// _tests/file/tikz.test.ts, `npx tsx _tests/file/tikz.test.ts`).
//
// Coordinate pipeline:
//   px -> TikZ cm, once, at the very end: x_cm = (x - minX) / 100,
//   y_cm = (maxY - y) / 100 — a y-flip (flow space is Y-down, TikZ/LaTeX
//   is Y-up) plus normalizing the whole picture to start at the origin.
//   100px = 1cm, chosen so grid.ts's 50px pitch lands on clean 0.5cm
//   multiples. Bare TikZ coordinate numbers are already centimeters (a
//   tikzpicture's default unit vectors are 1cm/1cm) — no `cm` suffix
//   needed.

import { buildDrawCmds, cmdVecs, SHARE_BASE, FORM_STROKE_PT, type DrawCmd, type Vec } from '../ir/geometry-ir'
import { STEP_RADIUS } from '../domain/wirepath'
import { encodeDiagramToFragment } from '../persist/share'
import type { Diagram, Color } from '../domain/types'

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

function tikzColorRef(c: Color | 'black' | undefined, registry: ColorRegistry): string {
  if (c === undefined || c === 'black') return 'black'
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
    case 'pointCircle': {
      // fillColor is always set (white, or a color flattened over white —
      // see geometry-ir.ts's buildPointCmds) and fully opaque — the glyph
      // masks whatever's underneath (a wire's end, a form's border) on the
      // assumed-white export page. Stroke is always plain black.
      const fill = tikzColorRef(cmd.fillColor, registry)
      return `\\filldraw[fill=${fill}, draw=black, line width=${FORM_STROKE_PT}pt] (${c(cmd.pos)}) circle (${lenCm(cmd.radiusPx)});`
    }
    case 'pointPolygon': {
      const fill = tikzColorRef(cmd.fillColor, registry)
      const path = cmd.pts.map((p) => `(${c(p)})`).join(' -- ')
      return `\\filldraw[fill=${fill}, draw=black, line width=${FORM_STROKE_PT}pt] ${path} -- cycle;`
    }
    case 'line': {
      const color = tikzColorRef(cmd.color, registry)
      const opts = `${color}, line width=${cmd.widthPt}pt`
      if (cmd.style === 'bezier' && cmd.c1 && cmd.c2) {
        return `\\draw[${opts}] (${c(cmd.from)}) .. controls (${c(cmd.c1)}) and (${c(cmd.c2)}) .. (${c(cmd.to)});`
      }
      if (cmd.style === 'smoothstep' && cmd.elbowPoints && cmd.elbowPoints.length > 2) {
        // Native `--`-segment polyline through the SAME (pre-rounded) elbow
        // points wirepath.ts's smoothstepElbowPoints computed for the canvas
        // SVG path — `rounded corners=` is TikZ's own equivalent of the
        // canvas path's quarter-circle arcs, visually equivalent without
        // needing to hand-emit `arc` commands here.
        const path = cmd.elbowPoints.map((p) => `(${c(p)})`).join(' -- ')
        return `\\draw[${opts}, rounded corners=${lenCm(STEP_RADIUS)}] ${path};`
      }
      return `\\draw[${opts}] (${c(cmd.from)}) -- (${c(cmd.to)});`
    }
    case 'label': {
      // masked (line-name/point-name labels): a white-filled node so the
      // wire it sits on doesn't strike through the text, matching canvas's
      // own canvas-colored mask bands (LineEdge.tsx/PointVisual.tsx) —
      // exports assume a white page, so plain white stands in for "canvas
      // background". inner sep=2pt keeps the white box tight around the
      // text, matching the canvas band's own tightness. Form-name labels
      // stay unmasked (masked: false) — a white box over a colored form's
      // tint would look wrong, and canvas doesn't mask form names either.
      // maskOnly: the SAME node, sized by the same text, but with the glyphs
      // made invisible — so the white backing lands exactly where the text
      // will, while being painted earlier (under the form bodies).
      const opts = [...(cmd.masked ? ['fill=white', 'inner sep=2pt'] : []),
        ...(cmd.maskOnly ? ['text opacity=0'] : []),
        ...(cmd.anchor ? [`anchor=${cmd.anchor}`] : [])]
      const opt = opts.length ? `[${opts.join(', ')}] ` : ' '
      return `\\node${opt}at (${c(cmd.at)}) {${cmd.text}};`
    }
  }
}

// The pure, synchronous core — geometry + string generation only. Takes an
// already-computed share fragment (or none, if the header line should be
// omitted) so it never needs the browser-only compression APIs
// encodeDiagramToFragment relies on (see persist/share.ts). This is what
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

  // Self-contained auto-centering wrapper: a `nesycatfig` environment,
  // GUARD-defined (\@ifundefined{nesycatfig}) so pasting several exports
  // into the same document — or a document whose own preamble already
  // defines it — only defines it once. It centers the figure and, when
  // `graphicx`'s \resizebox is available (\@ifundefined{resizebox} probes
  // for it — this file has NO \usepackage of its own, so it must degrade
  // gracefully rather than assume graphicx is loaded), shrinks it to
  // \linewidth only if it would otherwise overflow; without \resizebox it
  // just centers at native size. NOT emitted when this string is used as
  // TikZ SOURCE embedded some other way (e.g. re-imported via the share
  // fragment) — this wrapper is purely a paste-into-LaTeX convenience
  // layered around the SAME tikzpicture every other consumer (the share
  // link decode, _tests/file/tikz.test.ts's own content assertions) reads.
  return [
    ...header,
    '\\makeatletter\\@ifundefined{nesycatfig}{%',
    '\\newsavebox\\nesycatfigbox',
    '\\newenvironment{nesycatfig}{\\par\\begin{lrbox}{\\nesycatfigbox}}{\\end{lrbox}\\begin{center}%',
    '\\@ifundefined{resizebox}{\\usebox{\\nesycatfigbox}}{%',
    '\\ifdim\\wd\\nesycatfigbox>\\linewidth\\resizebox{\\linewidth}{!}{\\usebox{\\nesycatfigbox}}%',
    '\\else\\usebox{\\nesycatfigbox}\\fi}%',
    '\\end{center}}%',
    '}{}\\makeatother',
    '\\begin{nesycatfig}%',
    '\\begin{tikzpicture}',
    ...registry.definitions().map((l) => `  ${l}`),
    ...body.map((l) => `  ${l}`),
    '\\end{tikzpicture}',
    '\\end{nesycatfig}',
  ].join('\n')
}

// Async wrapper — pulls in the quiver-style re-import link via
// persist/share.ts's encodeDiagramToFragment, which is genuinely async
// (CompressionStream) and browser-oriented (though it also runs fine under
// modern node, which is why the test script can exercise this path too, not
// just diagramToTikzCore).
export async function diagramToTikz(diagram: Diagram): Promise<string> {
  const fragment = await encodeDiagramToFragment(diagram)
  return diagramToTikzCore(diagram, fragment)
}
