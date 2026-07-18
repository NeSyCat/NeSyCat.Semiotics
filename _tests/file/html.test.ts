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

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main()
