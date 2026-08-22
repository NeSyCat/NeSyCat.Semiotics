import { describe, expect, it } from 'vitest'
import { highlight, type HighlightLang } from '../../components/editor/export/highlight'

// Round-trip invariant: the tokenizer must never drop, add, or reorder
// characters — concatenating every token's text must reproduce the input
// exactly, for every language and every input (including malformed ones).
function assertRoundTrip(code: string, lang: HighlightLang) {
  const tokens = highlight(code, lang)
  expect(tokens.map((t) => t.text).join('')).toBe(code)
}

const EDGE_CASES = ['', '"abc', '{}()[]']

const SNIPPETS: Record<HighlightLang, string> = {
  prisma: `// a model\nmodel User {\n  id ObjectId @id @map("_id")\n  name String\n  bio String?\n  @@discriminator(kind)\n}\n`,
  latex: `% a tikz snippet\n\\begin{tikzpicture}\n  \\node (a) at (0,0) {A};\n  \\draw[->] (a) -- (1.5,2);\n\\end{tikzpicture}\n`,
  html: `<!-- a table -->\n<table>\n  <tr class="row" data-id="1">\n    <td>hi</td>\n  </tr>\n</table>\n`,
  json: `{\n  "name": "User",\n  "count": 42,\n  "active": true,\n  "deleted": null,\n  "tags": []\n}\n`,
}

describe('highlight — round-trip invariant', () => {
  const langs: HighlightLang[] = ['prisma', 'latex', 'html', 'json']
  for (const lang of langs) {
    describe(lang, () => {
      for (const code of EDGE_CASES) {
        it(`preserves text for edge case ${JSON.stringify(code)}`, () => {
          assertRoundTrip(code, lang)
        })
      }
      it('preserves text for a realistic multi-line snippet', () => {
        assertRoundTrip(SNIPPETS[lang], lang)
      })
    })
  }
})

describe('highlight — prisma kinds', () => {
  it('model User { → keyword "model" and type "User"', () => {
    const tokens = highlight('model User {', 'prisma')
    expect(tokens).toContainEqual({ text: 'model', kind: 'keyword' })
    expect(tokens).toContainEqual({ text: 'User', kind: 'type' })
  })

  it('// x → a comment token', () => {
    const tokens = highlight('// x', 'prisma')
    expect(tokens.some((t) => t.kind === 'comment' && t.text === '// x')).toBe(true)
  })

  it('@@discriminator → an attr token', () => {
    const tokens = highlight('@@discriminator(kind)', 'prisma')
    expect(tokens.some((t) => t.kind === 'attr' && t.text === '@@discriminator')).toBe(true)
  })

  it('"x" → a string token', () => {
    const tokens = highlight('"x"', 'prisma')
    expect(tokens).toContainEqual({ text: '"x"', kind: 'string' })
  })
})

describe('highlight — json kinds', () => {
  it('"k" before a colon → property', () => {
    const tokens = highlight('{"k": 1}', 'json')
    expect(tokens.some((t) => t.kind === 'property' && t.text === '"k"')).toBe(true)
  })

  it('true / null → boolean', () => {
    const tokens = highlight('[true, null]', 'json')
    expect(tokens).toContainEqual({ text: 'true', kind: 'boolean' })
    expect(tokens).toContainEqual({ text: 'null', kind: 'boolean' })
  })

  it('42 → number', () => {
    const tokens = highlight('42', 'json')
    expect(tokens).toContainEqual({ text: '42', kind: 'number' })
  })
})

describe('highlight — latex kinds', () => {
  it('\\node → keyword', () => {
    const tokens = highlight('\\node (a)', 'latex')
    expect(tokens).toContainEqual({ text: '\\node', kind: 'keyword' })
  })

  it('% c → comment', () => {
    const tokens = highlight('% c', 'latex')
    expect(tokens).toContainEqual({ text: '% c', kind: 'comment' })
  })
})

describe('highlight — html kinds', () => {
  it('<!-- c --> → comment', () => {
    const tokens = highlight('<!-- c -->', 'html')
    expect(tokens).toContainEqual({ text: '<!-- c -->', kind: 'comment' })
  })

  it('<div class="a"> → attr "class" and string "a"', () => {
    const tokens = highlight('<div class="a">', 'html')
    expect(tokens.some((t) => t.kind === 'attr' && t.text === 'class')).toBe(true)
    expect(tokens).toContainEqual({ text: '"a"', kind: 'string' })
  })
})
