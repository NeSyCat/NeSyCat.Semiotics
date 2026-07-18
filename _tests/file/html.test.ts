// Standalone test script for the HTML/SVG exporter — runs directly under tsx:
//
//   npx tsx _tests/file/html.test.ts

import { diagramToHtmlCore, diagramToHtml } from '../../components/editor2/html'
import type { Diagram, Form } from '../../components/editor2/types'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`PASS: ${msg}`) } else { fail++; console.log(`FAIL: ${msg}`) }
}

function bareSquare(id: string, position: { x: number; y: number }, extra: Partial<Form> = {}): Form {
  return { id, kind: 'square', position, edges: {}, corners: {}, ...extra }
}

async function main() {
  // ── structural sanity: valid, self-contained SVG, no NaN/undefined ────
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
  assert(html.startsWith('<!-- Exported from NeSyCat Semiotics -->') || html.includes('<!-- Exported from NeSyCat Semiotics -->'), 'header comment present')
  assert(html.includes('<svg') && html.includes('</svg>'), 'output is a self-contained <svg>...</svg>')
  assert(/viewBox="[-\d. ]+"/.test(html), 'viewBox attribute present and well-formed')
  assert(!/NaN/.test(html), 'no NaN in output')
  assert(!/undefined/.test(html), 'no undefined in output')

  // ── colored form -> a <polygon> with the matching fill color ──────────
  assert(/<polygon points="[^"]+" fill="rgb\(255, 0, 0\)"/.test(html), 'red form emits a red-filled <polygon>')

  // ── name label renders as PLAIN text, no leftover $ delimiters ────────
  assert(/<text[^>]*>square<\/text>/.test(html), 'form name renders as plain text, unwrapped from $...$')
  assert(!html.includes('$square$'), 'no literal $ delimiters leak into the SVG text')

  // ── header comment carries the re-import fragment when provided ───────
  const withFrag = diagramToHtmlCore(d, 'd=1.deadbeef')
  assert(withFrag.includes('https://semiotics.nesycat.org/editor#d=1.deadbeef'), 'quiver-style re-import link present when a fragment is supplied')

  // ── async wrapper resolves ─────────────────────────────────────────────
  try {
    const full = await diagramToHtml(d)
    assert(full.includes('<svg') && full.includes('#d='), 'async diagramToHtml resolves with an embedded re-import fragment')
  } catch (err) {
    assert(false, `async diagramToHtml should not throw — ${err}`)
  }

  // ── empty diagram doesn't crash (degenerate bounding box) ─────────────
  const empty = diagramToHtmlCore({ schemaVersion: 1, forms: [], points: {}, lines: [] })
  assert(empty.includes('<svg') && !/NaN/.test(empty), 'an empty diagram still produces a valid, NaN-free SVG')

  // ── geometry: y is NOT flipped (SVG is Y-down like flow space) ────────
  // H1 sits at flow y=0 (center 100), H2 lower at y=100 (center 200): the
  // higher-on-screen form must keep the SMALLER y in the SVG output.
  const polys = [...html.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1])
  const avgY = (pts: string) => {
    const ys = pts.split(' ').map((p) => Number(p.split(',')[1]))
    return ys.reduce((a, b) => a + b, 0) / ys.length
  }
  assert(polys.length === 2 && avgY(polys[0]) < avgY(polys[1]), 'no y-flip: screen-higher form has smaller SVG y')

  // ── geometry: circle bodies are inside the viewBox, not clipped ───────
  // A lone circle-kind form (r = n/2 = 100) — the viewBox must contain
  // center ± r, not just the center point.
  const circleOnly: Diagram = {
    schemaVersion: 1,
    forms: [{ id: 'C1', kind: 'circle', position: { x: 0, y: 0 }, edges: {}, corners: {} }],
    points: {},
    lines: [],
  }
  const csvg = diagramToHtmlCore(circleOnly)
  const vb = csvg.match(/viewBox="([-\d. ]+)"/)![1].split(' ').map(Number)
  const cm = csvg.match(/<circle cx="([-\d.]+)" cy="([-\d.]+)" r="([-\d.]+)"/)!
  const [cx, cy, r] = [Number(cm[1]), Number(cm[2]), Number(cm[3])]
  const contained =
    vb[0] <= cx - r && vb[1] <= cy - r && vb[0] + vb[2] >= cx + r && vb[1] + vb[3] >= cy + r
  assert(contained, `circle body fully inside viewBox — got viewBox [${vb}] for circle (${cx},${cy}) r=${r}`)

  // ── form outlines match the canvas's 1.5px border, not TikZ's 0.4pt ───
  assert(/<polygon [^>]*stroke-width="1.5"/.test(html), 'form outline stroke-width is 1.5 (canvas parity)')
  assert(!/stroke-width="0.4"/.test(html + csvg), 'no TikZ pt-value stroke widths leak into the SVG')

  // ── point-label side: TikZ anchor=east (label LEFT of the point) must ─
  // become SVG text-anchor="end" (text ends at the point, extending left),
  // not "start" — the two conventions are inverses.
  const named: Diagram = {
    schemaVersion: 1,
    forms: [{ id: 'N1', kind: 'square', position: { x: 0, y: 0 }, edges: { left: ['p1'] }, corners: {} }],
    points: { p1: { id: 'p1', shape: 'point', name: 'in', formId: 'N1', edgeKey: 'left' } },
    lines: [],
  }
  const nsvg = diagramToHtmlCore(named)
  assert(/<text[^>]*text-anchor="end"[^>]*>in<\/text>/.test(nsvg), 'left-edge point label anchors text-anchor="end" (extends away from the form)')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main()
