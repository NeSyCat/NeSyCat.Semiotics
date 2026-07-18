// Pure text-sniffing for the Import panel — recognizes a pasted NeSyCat
// share link/fragment OR TikZ code THIS editor exported. Not a general TikZ
// parser: round-trip for TikZ works because tikz.ts's diagramToTikz embeds
// the exact same share-fragment as a header comment
// (`% https://…/editor#d=<scheme>.<payload>`), so "importing TikZ" and
// "importing a link" both reduce to the same thing — finding that one
// `d=<scheme>.<payload>` token wherever it's embedded (a bare fragment, a
// full URL's hash, or a comment line inside pasted TikZ) and handing it to
// share.ts's decodeDiagramFromFragment.

const FRAGMENT_RE = /d=[01]\.[A-Za-z0-9_-]+/

export function extractFragment(pasted: string): string | null {
  const m = pasted.match(FRAGMENT_RE)
  return m ? m[0] : null
}
