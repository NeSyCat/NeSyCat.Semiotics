// Test suite for the Import panel's text-sniffing (round-trip with the
// TikZ/share exporters). Runs under Vitest:
//
//   npm test

import { describe, expect, it } from 'vitest'
import { extractFragment } from '../../components/editor/importText'
import { diagramToTikz } from '../../components/editor/tikz'
import { encodeDiagramToFragment, decodeDiagramFromFragment } from '../../components/editor/share'
import type { Diagram, Form } from '../../components/editor/types'

function bareSquare(id: string, position: { x: number; y: number }): Form {
  return { id, shape: 'square', position, edges: {} }
}

const d: Diagram = { schemaVersion: 1, forms: [bareSquare('X1', { x: 0, y: 0 })], points: {}, lines: [] }

describe('import panel text-sniffing', () => {
  it('extractFragment on plain/URL-wrapped fragments', () => {
    expect(extractFragment('d=0.abc-DEF_123'), 'extractFragment finds a bare fragment').toBe('d=0.abc-DEF_123')
    expect(
      extractFragment('https://semiotics.nesycat.org/editor#d=1.XyZ_-9'),
      'extractFragment finds a fragment inside a full share URL',
    ).toBe('d=1.XyZ_-9')
    expect(extractFragment('no fragment in here'), 'extractFragment returns null when nothing matches').toBeNull()
  })

  it('round trip: export TikZ -> extract -> decode -> same diagram shape', async () => {
    const tikz = await diagramToTikz(d)
    const fromTikz = extractFragment(tikz)
    expect(fromTikz, 'extractFragment finds the fragment embedded in exported TikZ').not.toBeNull()
    if (fromTikz) {
      const decoded = await decodeDiagramFromFragment(fromTikz)
      expect(decoded, 'the fragment recovered from TikZ decodes back to a diagram').not.toBeNull()
      expect(
        decoded?.forms.length === 1 && decoded.forms[0].id === 'X1',
        'the round-tripped diagram matches the original (form id X1 present)',
      ).toBe(true)
    }
  })

  it('round trip: encode -> full URL -> extract -> decode', async () => {
    const frag = await encodeDiagramToFragment(d)
    const url = `https://semiotics.nesycat.org/editor#${frag}`
    const fromUrl = extractFragment(url)
    expect(fromUrl, 'extractFragment recovers the exact fragment from a share URL').toBe(frag)
    const decodedFromUrl = fromUrl ? await decodeDiagramFromFragment(fromUrl) : null
    expect(decodedFromUrl?.forms[0]?.id, 'the URL round trip decodes back to the original diagram').toBe('X1')
  })
})
