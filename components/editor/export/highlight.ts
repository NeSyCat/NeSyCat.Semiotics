// Thin, lazy-loaded wrapper around Shiki for the Export panel's code view.
// Shiki does the actual tokenizing + colouring via its bundled theme; we only
// map our own format names to Shiki's grammar ids and cache a single
// highlighter instance across calls.
//
// The `import('shiki')` below is dynamic on purpose: Shiki bundles its own
// grammars/themes/wasm and is sizeable, so keeping it out of the static
// import graph keeps it out of the main bundle — it's only fetched once the
// Export panel actually needs to highlight something.

import type { Highlighter } from 'shiki'

export type HighlightLang = 'prisma' | 'latex' | 'html' | 'json'

const GRAMMAR: Record<HighlightLang, string> = { prisma: 'prisma', latex: 'latex', html: 'html', json: 'json' }

// 'one-light' (Atom/VS Code One Light) — the light-background sibling of the
// One Dark the user's editor uses: same colour roles (salmon field names, gold
// types, cyan @-attributes, green strings, purple keywords) on a light ground.
// Bundled by Shiki (verified) alongside every grammar this panel needs.
const THEME = 'one-light'

let hp: Promise<Highlighter> | null = null
function getHighlighter() {
  if (!hp) hp = import('shiki').then((s) => s.createHighlighter({ themes: [THEME], langs: ['prisma', 'latex', 'json', 'html'] }))
  return hp
}

// Returns Shiki's HTML (a `<pre class="shiki">…</pre>` with inline token
// colours from the theme — we do NOT hand-pick colours).
export async function highlightToHtml(code: string, lang: HighlightLang): Promise<string> {
  const h = await getHighlighter()
  return h.codeToHtml(code, { lang: GRAMMAR[lang], theme: THEME })
}

export { GRAMMAR }
