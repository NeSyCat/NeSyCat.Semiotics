// Test suite for the HTML/SVG exporter. Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { diagramToHtmlCore, diagramToHtml } from '../../components/editor/export/html'
import { pointPositionsPx, formCenterPx, rotateAbout } from '../../components/editor/ir/geometry-ir'
import { geometryFor, bodyCentroid } from '../../components/editor/domain/forms'
import { wirePath, dirFromCardinal, type EdgeStyle } from '../../components/editor/domain/wirepath'
import type { Diagram, Form } from '../../components/editor/domain/types'

function approx(a: number, b: number, tol = 1e-6): boolean {
  return Math.abs(a - b) <= tol
}

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

  it('unwraps \\mathtt{...} (and friends) to plain text so labels do not leak LaTeX', () => {
    const d = { schemaVersion: 1, forms: [{ id: 'F', shape: 'square' as const, name: '\\mathtt{User}', position: { x: 0, y: 0 }, edges: {} }], points: {}, lines: [] }
    const out = diagramToHtmlCore(d)
    expect(out).toMatch(/<text[^>]*>User<\/text>/)
    expect(out.includes('\\mathtt'), 'no raw \\mathtt leaks into the SVG').toBe(false)
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

  it('a named hyperedge (2 targets) — every branch carries a white-backed name label', () => {
    const w: Diagram = {
      schemaVersion: 1,
      forms: [
        { id: 'WF1', shape: 'square', position: { x: 0, y: 0 }, edges: { top: [], right: ['WP1'], bottom: [], left: [] } },
        { id: 'WF2', shape: 'square', position: { x: 300, y: -50 }, edges: { top: [], right: [], bottom: [], left: ['WP2'] } },
        { id: 'WF3', shape: 'square', position: { x: 300, y: 150 }, edges: { top: [], right: [], bottom: [], left: ['WP3'] } },
      ],
      points: {
        WP1: { id: 'WP1', shape: 'empty', formId: 'WF1', edgeKey: 'right' },
        WP2: { id: 'WP2', shape: 'empty', formId: 'WF2', edgeKey: 'left' },
        WP3: { id: 'WP3', shape: 'empty', formId: 'WF3', edgeKey: 'left' },
      },
      lines: [{ id: 'WL1', name: 'f', source: 'WP1', targets: ['WP2', 'WP3'] }],
    }
    const wsvg = diagramToHtmlCore(w)
    // rect-before-text pattern, white fill.
    expect(wsvg, "the wire-name label's white backing rect immediately precedes its <text>").toMatch(
      /<rect[^>]*fill="white"\/>\s*<text[^>]*>f<\/text>/,
    )
    // The name renders on EVERY branch of the hyperedge (user decision:
    // each branch of a fork shows the wire's type) — one label per target.
    expect((wsvg.match(/>f<\/text>/g) ?? []).length, 'the wire name appears once per branch (2 targets)').toBe(2)
    // Two wire segments are still drawn (both targets get their own wire) —
    // <path>, not <line>, since export/html.ts now draws every wire style
    // (including the default 'straight') through wirepath.ts's SVG path.
    expect((wsvg.match(/<path d="M[^"]*"/g) ?? []).length, 'both segments are drawn').toBe(2)
  })

  it('form names emit WITHOUT a white backing rect (unmasked)', () => {
    const f: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'FF1', shape: 'square', position: { x: 0, y: 0 }, edges: {}, name: 'Bool', color: [1, 0, 0.5] }],
      points: {},
      lines: [],
    }
    const fsvg = diagramToHtmlCore(f)
    expect(fsvg, 'form-name <text> is emitted').toMatch(/<text[^>]*>Bool<\/text>/)
    expect(fsvg, 'form-name label carries no preceding white backing rect').not.toMatch(/<rect[^>]*fill="white"\/>\s*<text[^>]*>Bool<\/text>/)
  })

  it('named point labels carry a white backing rect (masked), matching wire-name labels', () => {
    const p: Diagram = {
      schemaVersion: 1,
      forms: [{ id: 'PF1', shape: 'square', position: { x: 0, y: 0 }, edges: { top: [], right: [], bottom: [], left: ['PP1'] } }],
      points: { PP1: { id: 'PP1', shape: 'circle', name: 'x', formId: 'PF1', edgeKey: 'left' } },
      lines: [],
    }
    const psvg = diagramToHtmlCore(p)
    expect(psvg, "the point-name label's white backing rect immediately precedes its <text>").toMatch(
      /<rect[^>]*fill="white"\/>\s*<text[^>]*>x<\/text>/,
    )
  })

  it("a triangle's form-name label sits at the polygon CENTROID (not the bbox center); a square's stays at its (identical) center", () => {
    const tri: Form = { id: 'CT1', shape: 'triangle', position: { x: 0, y: 0 }, edges: { a: [], b: [], c: [], peak: [] }, name: 'even' }
    const geom = geometryFor('triangle')
    const n = geom.nodeSize(tri)
    const [cfx, cfy] = bodyCentroid(geom.body)
    const expectedCentroidPx = { x: tri.position.x + cfx * n, y: tri.position.y + cfy * n }
    // NOTE: post-resize (triangle now inscribed in the circumradius-0.5
    // circle centred at (0.5, 0.5), so full containment survives rotation —
    // see forms.ts), the equilateral triangle's centroid coincides EXACTLY
    // with the box center: an equilateral triangle's centroid IS its
    // circumcenter, and the circumcenter was deliberately placed at the
    // box's own center. So this no longer distinguishes "uses centroid" from
    // "uses bbox center" for the UNROTATED case (both land on n/2) — that's
    // an intentional consequence of the containment fix, not a regression
    // back to the old bbox-center bug. The label position assertions below
    // (driven by the SAME bodyCentroid the render path itself consumes) are
    // the load-bearing check — they still fail if the render path ever
    // hardcodes n/2 instead of calling bodyCentroid, even though the two
    // now agree numerically for this shape's UNROTATED case.
    expect(approx(expectedCentroidPx.x, n / 2), 'triangle centroid x now coincides with bbox-center x by construction (inscribed-circle resize)').toBe(true)

    const t: Diagram = { schemaVersion: 1, forms: [tri], points: {}, lines: [] }
    const tsvg = diagramToHtmlCore(t)
    const m = tsvg.match(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>even<\/text>/)
    expect(!!m, 'triangle form-name <text> is emitted and parses').toBe(true)
    if (m) {
      expect(Math.abs(Number(m[1]) - expectedCentroidPx.x) < 0.01, `triangle label x matches the hand-computed centroid (got ${m[1]}, want ${expectedCentroidPx.x})`).toBe(true)
      expect(Math.abs(Number(m[2]) - expectedCentroidPx.y) < 0.01, `triangle label y matches the hand-computed centroid (got ${m[2]}, want ${expectedCentroidPx.y})`).toBe(true)
    }

    const sq: Form = { id: 'CS1', shape: 'square', position: { x: 500, y: 0 }, edges: {}, name: 'sq' }
    const sqCenter = formCenterPx(sq)
    const sqDiagram: Diagram = { schemaVersion: 1, forms: [sq], points: {}, lines: [] }
    const sqSvg = diagramToHtmlCore(sqDiagram)
    const sqM = sqSvg.match(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>sq<\/text>/)
    expect(!!sqM, 'square form-name <text> is emitted and parses').toBe(true)
    if (sqM) {
      expect(Math.abs(Number(sqM[1]) - sqCenter.x) < 0.01, 'square label x stays at the bbox/centroid-coincident center').toBe(true)
      expect(Math.abs(Number(sqM[2]) - sqCenter.y) < 0.01, 'square label y stays at the bbox/centroid-coincident center').toBe(true)
    }
  })

  it("a ROTATED triangle's form-name label sits at the ROTATED centroid", () => {
    const tri: Form = { id: 'RT1', shape: 'triangle', position: { x: 0, y: 0 }, rotation: 40, edges: { a: [], b: [], c: [], peak: [] }, name: 'r' }
    const geom = geometryFor('triangle')
    const n = geom.nodeSize(tri)
    const [cfx, cfy] = bodyCentroid(geom.body)
    const preRotationAbs = { x: tri.position.x + cfx * n, y: tri.position.y + cfy * n }
    const center = formCenterPx(tri)
    const expectedCentroidPx = rotateAbout(preRotationAbs, center, tri.rotation!)

    const t: Diagram = { schemaVersion: 1, forms: [tri], points: {}, lines: [] }
    const tsvg = diagramToHtmlCore(t)
    const m = tsvg.match(/<text x="([-\d.]+)" y="([-\d.]+)"[^>]*>r<\/text>/)
    expect(!!m, 'rotated triangle form-name <text> is emitted and parses').toBe(true)
    if (m) {
      expect(Math.abs(Number(m[1]) - expectedCentroidPx.x) < 0.01, `rotated triangle label x matches the rotated centroid (got ${m[1]}, want ${expectedCentroidPx.x})`).toBe(true)
      expect(Math.abs(Number(m[2]) - expectedCentroidPx.y) < 0.01, `rotated triangle label y matches the rotated centroid (got ${m[2]}, want ${expectedCentroidPx.y})`).toBe(true)
    }
  })

  // ── edgeStyle: straight / bezier / smoothstep ──────────────────────
  // Same two-square, one-line fixture as the tikz suite's wireDiagram —
  // source faces 'right', target faces 'left'. `targetY` defaults to 0 (the
  // two points then land perfectly level, y=100 each) — the smoothstep test
  // below overrides it, since a level pair is now (correctly, post wire-
  // straightening-fix) collapsed to a plain straight line by wirepath.ts's
  // own cross-axis straightness guard, and an actual elbow needs the two
  // endpoints off-axis from one another.
  function wireDiagram(edgeStyle?: EdgeStyle, targetY = 0): Diagram {
    const w: Diagram = {
      schemaVersion: 1,
      forms: [
        { id: 'EF1', shape: 'square', position: { x: 0, y: 0 }, edges: { top: [], right: ['EP1'], bottom: [], left: [] } },
        { id: 'EF2', shape: 'square', position: { x: 300, y: targetY }, edges: { top: [], right: [], bottom: [], left: ['EP2'] } },
      ],
      points: {
        EP1: { id: 'EP1', shape: 'empty', formId: 'EF1', edgeKey: 'right' },
        EP2: { id: 'EP2', shape: 'empty', formId: 'EF2', edgeKey: 'left' },
      },
      lines: [{ id: 'EL1', source: 'EP1', targets: ['EP2'] }],
    }
    if (edgeStyle) w.edgeStyle = edgeStyle
    return w
  }

  // HTML/SVG coordinates are NOT normalized (unlike TikZ's px->cm + minX/
  // maxY shift) — wirePath's own `d` string can be asserted verbatim.
  function expectedWireD(w: Diagram, style: EdgeStyle): string {
    const positions = pointPositionsPx(w)
    const src = positions.get('EP1')!
    const tgt = positions.get('EP2')!
    return wirePath(
      src.pos.x, src.pos.y, dirFromCardinal(src.cardinal),
      tgt.pos.x, tgt.pos.y, dirFromCardinal(tgt.cardinal),
      style,
    ).d
  }

  it('edgeStyle absent (legacy/default doc) renders the wire as a straight <path> (M...L)', () => {
    const w = wireDiagram() // no edgeStyle field at all
    const wsvg = diagramToHtmlCore(w)
    const expectedD = expectedWireD(w, 'straight')
    expect(expectedD).toMatch(/^M .+ L .+$/)
    expect(wsvg).toContain(`<path d="${expectedD}" fill="none"`)
  })

  it("edgeStyle: 'bezier' renders the wire as a cubic <path> matching wirePath's own `d`", () => {
    // targetY=120 (off-axis from the source's y=100) so the wire clears
    // wirepath.ts's angular straightness guard and the curve actually renders.
    const w = wireDiagram('bezier', 120)
    const wsvg = diagramToHtmlCore(w)
    const expectedD = expectedWireD(w, 'bezier')
    expect(expectedD).toMatch(/^M .+ C .+$/)
    expect(wsvg).toContain(`<path d="${expectedD}" fill="none"`)
  })

  it("edgeStyle: 'smoothstep' renders the wire as a rounded-elbow <path> matching wirePath's own `d`", () => {
    // targetY=40 (off-axis from the source's y=100) so the wire actually
    // bends — see wireDiagram's own comment.
    const w = wireDiagram('smoothstep', 40)
    const wsvg = diagramToHtmlCore(w)
    const expectedD = expectedWireD(w, 'smoothstep')
    expect(expectedD).toMatch(/^M .+ A .+$/)
    expect(wsvg).toContain(`<path d="${expectedD}" fill="none"`)
  })

  it("edgeStyle: 'smoothstep' with near-level (but not exactly level) endpoints still snaps straight — the cross-axis straightness guard, not exact equality", () => {
    // targetY=0.5 -> the two points land 0.5px apart on the cross axis
    // (within wirepath.ts's STRAIGHT_MIN_PX=1 floor of the angular straightness guard) — still snaps straight.
    const w = wireDiagram('smoothstep', 0.5)
    const expectedD = expectedWireD(w, 'smoothstep')
    expect(expectedD).toMatch(/^M .+ L .+$/)
    expect(expectedD).not.toContain('A ')
  })

  it('a bezier curve that bulges past the endpoints stays inside the SVG viewBox (control points pad the bbox)', () => {
    // A short, sharply-turning wire: control points can extend well past a
    // straight bounding box of [from,to] alone — cmdVecs must include them.
    const w: Diagram = {
      schemaVersion: 1,
      forms: [
        { id: 'BF1', shape: 'square', position: { x: 0, y: 0 }, edges: { top: [], right: ['BP1'], bottom: [], left: [] } },
        { id: 'BF2', shape: 'square', position: { x: 250, y: 0 }, edges: { top: ['BP2'], right: [], bottom: [], left: [] } },
      ],
      points: {
        BP1: { id: 'BP1', shape: 'empty', formId: 'BF1', edgeKey: 'right' },
        BP2: { id: 'BP2', shape: 'empty', formId: 'BF2', edgeKey: 'top' },
      },
      lines: [{ id: 'BL1', source: 'BP1', targets: ['BP2'] }],
      edgeStyle: 'bezier',
    }
    const bsvg = diagramToHtmlCore(w)
    const viewBoxM = bsvg.match(/viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"/)
    expect(!!viewBoxM, 'viewBox is emitted').toBe(true)
    if (viewBoxM) {
      const [minX, minY, width, height] = viewBoxM.slice(1).map(Number)
      const positions = pointPositionsPx(w)
      const src = positions.get('BP1')!
      const tgt = positions.get('BP2')!
      const { c1, c2 } = wirePath(src.pos.x, src.pos.y, dirFromCardinal(src.cardinal), tgt.pos.x, tgt.pos.y, dirFromCardinal(tgt.cardinal), 'bezier')
      expect(c1).toBeDefined()
      expect(c2).toBeDefined()
      if (c1 && c2) {
        for (const p of [c1, c2]) {
          expect(p.x >= minX && p.x <= minX + width, `control point x=${p.x} sits inside the viewBox [${minX}, ${minX + width}]`).toBe(true)
          expect(p.y >= minY && p.y <= minY + height, `control point y=${p.y} sits inside the viewBox [${minY}, ${minY + height}]`).toBe(true)
        }
      }
    }
  })
})
