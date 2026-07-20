// Test suite for the HTML/SVG exporter. Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { diagramToHtmlCore, diagramToHtml } from '../../components/editor/export/html'
import { pointPositionsPx } from '../../components/editor/ir/geometry-ir'
import type { Diagram, Form } from '../../components/editor/domain/types'

function bareSquare(id: string, position: { x: number; y: number }, extra: Partial<Form> = {}): Form {
  return { id, shape: 'square', position, edges: {}, ...extra }
}

const d: Diagram = {
  schemaVersion: 1,
  forms: [
    bareSquare('H1', { x: 0, y: 0 }, { color: [1, 0, 0], name: 'square' }),
    bareSquare('H2', { x: 300, y: 100 }, { rotation: 45 }),
  ],
  points: {},
  lines: [],
}
const html = diagramToHtmlCore(d)

// A lone circle-shape form (r = n/2 = 100) — shared by the viewBox-containment
// check and the stroke-width check below.
const circleOnly: Diagram = {
  schemaVersion: 1,
  forms: [{ id: 'C1', shape: 'circle', position: { x: 0, y: 0 }, edges: {} }],
  points: {},
  lines: [],
}
const csvg = diagramToHtmlCore(circleOnly)

describe('HTML/SVG exporter', () => {
  it('structural sanity: valid, self-contained SVG, no NaN/undefined', () => {
    expect(
      html.startsWith('<!-- Exported from NeSyCat Semiotics -->') || html.includes('<!-- Exported from NeSyCat Semiotics -->'),
      'header comment present',
    ).toBe(true)
    expect(html.includes('<svg') && html.includes('</svg>'), 'output is a self-contained <svg>...</svg>').toBe(true)
    expect(html, 'viewBox attribute present and well-formed').toMatch(/viewBox="[-\d. ]+"/)
    expect(html, 'no NaN in output').not.toMatch(/NaN/)
    expect(html, 'no undefined in output').not.toMatch(/undefined/)
  })

  it('colored form -> a <polygon> with the matching fill color', () => {
    expect(html, 'red form emits a red-filled <polygon>').toMatch(/<polygon points="[^"]+" fill="rgb\(255, 0, 0\)"/)
  })

  it('name label renders as PLAIN text, no leftover $ delimiters', () => {
    expect(html, 'form name renders as plain text, unwrapped from $...$').toMatch(/<text[^>]*>square<\/text>/)
    expect(html.includes('$square$'), 'no literal $ delimiters leak into the SVG text').toBe(false)
  })

  it('header comment carries the re-import fragment when provided', () => {
    const withFrag = diagramToHtmlCore(d, 'd=1.deadbeef')
    expect(
      withFrag.includes('https://semiotics.nesycat.org/editor#d=1.deadbeef'),
      'quiver-style re-import link present when a fragment is supplied',
    ).toBe(true)
  })

  it('async wrapper resolves', async () => {
    try {
      const full = await diagramToHtml(d)
      expect(full.includes('<svg') && full.includes('#d='), 'async diagramToHtml resolves with an embedded re-import fragment').toBe(true)
    } catch (err) {
      expect(false, `async diagramToHtml should not throw — ${err}`).toBe(true)
    }
  })

  it("empty diagram doesn't crash (degenerate bounding box)", () => {
    const empty = diagramToHtmlCore({ schemaVersion: 1, forms: [], points: {}, lines: [] })
    expect(empty.includes('<svg') && !/NaN/.test(empty), 'an empty diagram still produces a valid, NaN-free SVG').toBe(true)
  })

  it('geometry: y is NOT flipped (SVG is Y-down like flow space)', () => {
    // H1 sits at flow y=0 (center 100), H2 lower at y=100 (center 200): the
    // higher-on-screen form must keep the SMALLER y in the SVG output.
    const polys = [...html.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1])
    const avgY = (pts: string) => {
      const ys = pts.split(' ').map((p) => Number(p.split(',')[1]))
      return ys.reduce((a, b) => a + b, 0) / ys.length
    }
    expect(polys.length === 2 && avgY(polys[0]) < avgY(polys[1]), 'no y-flip: screen-higher form has smaller SVG y').toBe(true)
  })

  it('geometry: circle bodies are inside the viewBox, not clipped', () => {
    // The viewBox must contain center ± r, not just the center point.
    const vb = csvg.match(/viewBox="([-\d. ]+)"/)![1].split(' ').map(Number)
    const cm = csvg.match(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/)!
    const [cx, cy, r] = [Number(cm[1]), Number(cm[2]), Number(cm[3])]
    const contained =
      vb[0] <= cx - r && vb[1] <= cy - r && vb[0] + vb[2] >= cx + r && vb[1] + vb[3] >= cy + r
    expect(contained, `circle body fully inside viewBox — got viewBox [${vb}] for circle (${cx},${cy}) r=${r}`).toBe(true)
  })

  it("form outlines match the canvas's 1.5px border, not TikZ's 0.4pt", () => {
    expect(html, 'form outline stroke-width is 1.5 (canvas parity)').toMatch(/<polygon [^>]*stroke-width="1.5"/)
    expect(html + csvg, 'no TikZ pt-value stroke widths leak into the SVG').not.toMatch(/stroke-width="0.4"/)
  })

  it('point-label side: TikZ anchor=east (label LEFT of the point) must become SVG text-anchor="end" (text ends at the point, extending left), not "start" — the two conventions are inverses', () => {
    const named: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'N1', shape: 'square', position: { x: 0, y: 0 }, edges: { left: ['p1'] } }],
      points: { p1: { id: 'p1', shape: 'circle', name: 'in', formId: 'N1', edgeKey: 'left' } },
      lines: [],
    }
    const nsvg = diagramToHtmlCore(named)
    expect(nsvg, 'left-edge point label anchors text-anchor="end" (extends away from the form)').toMatch(/<text[^>]*text-anchor="end"[^>]*>in<\/text>/)
  })

  it('point-glyph export parity — 26px-diameter (r=13) circle, white fill when uncolored, its own color flattened over white when colored, always a plain black 1.5px stroke', () => {
    const g: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'GF1', shape: 'square', position: { x: 0, y: 0 }, edges: { top: [], right: ['GP1', 'GP2'], bottom: [], left: [] } }],
      points: {
        GP1: { id: 'GP1', shape: 'circle', formId: 'GF1', edgeKey: 'right' }, // uncolored
        GP2: { id: 'GP2', shape: 'circle', formId: 'GF1', edgeKey: 'right', color: [1, 0, 0] }, // red
      },
      lines: [],
    }
    const gsvg = diagramToHtmlCore(g)
    // POINT_SIZE (domain/forms.ts) is 26px -> glyph radius 13px, in raw SVG
    // user units (no px->cm conversion, unlike TikZ).
    expect(gsvg, 'uncolored point glyph: r=13, opaque white fill, black stroke').toMatch(/<circle[^>]*r="13"[^>]*fill="rgb\(255, 255, 255\)"[^>]*stroke="black" stroke-width="1\.5"\/>/)
    // Red [1,0,0] tinted at FORM_FILL_OPACITY (0.18) over white flattens to
    // (255, 209, 209) — same math as geometry-ir.ts's flattenOverWhite.
    expect(gsvg, 'red point glyph flattens to rgb(255, 209, 209) over white').toMatch(/<circle[^>]*r="13"[^>]*fill="rgb\(255, 209, 209\)"[^>]*stroke="black" stroke-width="1\.5"\/>/)
    expect(gsvg, 'no leftover fill-opacity attribute on a point glyph (export flattens to one opaque color)').not.toMatch(/r="13"[^>]*fill-opacity/)
  })

  it("triangle 'peak' point exports at the apex vertex, matching pointPositionsPx (raw px, no unit conversion)", () => {
    const tri: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'PT1', shape: 'triangle', position: { x: 0, y: 0 }, edges: { a: [], b: [], c: [], peak: ['PK1'] } }],
      points: { PK1: { id: 'PK1', shape: 'circle', formId: 'PT1', edgeKey: 'peak' } },
      lines: [],
    }
    const expected = pointPositionsPx(tri).get('PK1')!.pos
    const psvg = diagramToHtmlCore(tri)
    const m = psvg.match(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="13"/)
    expect(!!m, 'the peak point glyph is emitted').toBe(true)
    if (m) {
      // round() (html.ts) rounds to 2 decimal places — tolerance covers that.
      expect(Math.abs(Number(m[1]) - expected.x) < 0.01, `peak glyph cx matches pointPositionsPx's apex x (got ${m[1]}, want ${expected.x})`).toBe(true)
      expect(Math.abs(Number(m[2]) - expected.y) < 0.01, `peak glyph cy matches pointPositionsPx's apex y (got ${m[2]}, want ${expected.y})`).toBe(true)
    }
  })
})
