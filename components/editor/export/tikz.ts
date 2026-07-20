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
      const color = tikzColorRef(cmd.color, registry)
      return `\\draw[${color}] (${c(cmd.pos)}) circle (${lenCm(cmd.radiusPx)});`
    }
    case 'pointPolygon': {
      const color = tikzColorRef(cmd.color, registry)
      const path = cmd.pts.map((p) => `(${c(p)})`).join(' -- ')
      return `\\draw[${color}] ${path} -- cycle;`
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

  return [
    ...header,
    '\\begin{tikzpicture}',
    ...registry.definitions().map((l) => `  ${l}`),
    ...body.map((l) => `  ${l}`),
    '\\end{tikzpicture}',
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
