// Standalone test script for the Import panel's text-sniffing (round-trip
// with the TikZ/share exporters) — runs directly under tsx:
//
//   npx tsx _tests/file/import.test.ts

import { extractFragment } from '../../components/editor2/importText'
import { diagramToTikz } from '../../components/editor2/tikz'
import { encodeDiagramToFragment, decodeDiagramFromFragment } from '../../components/editor2/share'
import type { Diagram, Form } from '../../components/editor2/types'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string) {
  if (cond) { pass++; console.log(`PASS: ${msg}`) } else { fail++; console.log(`FAIL: ${msg}`) }
}

function bareSquare(id: string, position: { x: number; y: number }): Form {
  return { id, kind: 'square', position, edges: {}, corners: {} }
}

async function main() {
  const d: Diagram = { schemaVersion: 1, forms: [bareSquare('X1', { x: 0, y: 0 })], points: {}, lines: [] }

  // ── extractFragment on plain/URL-wrapped fragments ────────────────────
  assert(extractFragment('d=0.abc-DEF_123') === 'd=0.abc-DEF_123', 'extractFragment finds a bare fragment')
  assert(
    extractFragment('https://semiotics.nesycat.org/editor#d=1.XyZ_-9') === 'd=1.XyZ_-9',
    'extractFragment finds a fragment inside a full share URL',
  )
  assert(extractFragment('no fragment in here') === null, 'extractFragment returns null when nothing matches')

  // ── round trip: export TikZ -> extract -> decode -> same diagram shape ─
  const tikz = await diagramToTikz(d)
  const fromTikz = extractFragment(tikz)
  assert(fromTikz !== null, 'extractFragment finds the fragment embedded in exported TikZ')
  if (fromTikz) {
    const decoded = await decodeDiagramFromFragment(fromTikz)
    assert(decoded !== null, 'the fragment recovered from TikZ decodes back to a diagram')
    assert(decoded?.forms.length === 1 && decoded.forms[0].id === 'X1', 'the round-tripped diagram matches the original (form id X1 present)')
  }

  // ── round trip: encode -> full URL -> extract -> decode ────────────────
  const frag = await encodeDiagramToFragment(d)
  const url = `https://semiotics.nesycat.org/editor#${frag}`
  const fromUrl = extractFragment(url)
  assert(fromUrl === frag, 'extractFragment recovers the exact fragment from a share URL')
  const decodedFromUrl = fromUrl ? await decodeDiagramFromFragment(fromUrl) : null
  assert(decodedFromUrl?.forms[0]?.id === 'X1', 'the URL round trip decodes back to the original diagram')

  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail > 0 ? 1 : 0)
}

main()
