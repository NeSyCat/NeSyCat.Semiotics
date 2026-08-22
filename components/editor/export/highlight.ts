// A tiny, dependency-free syntax highlighter for the Export panel's code
// view. Deliberately NOT a general-purpose tokenizer: it covers only the
// four languages the exporters actually emit (Prisma, LaTeX/TikZ, HTML,
// JSON), and only the constructs those exporters produce.
//
// CRITICAL INVARIANT: for every input string `code`,
//   highlight(code, lang).map(t => t.text).join('') === code
// The scanner never drops, adds, or reorders characters — every byte of the
// input ends up in exactly one token, in order. Runs of characters that
// don't match any rule are coalesced into a single 'plain' token rather than
// emitted one character at a time.

export type HighlightLang = 'prisma' | 'latex' | 'html' | 'json'

export type TokenKind =
  | 'plain' | 'comment' | 'string' | 'number' | 'keyword'
  | 'attr' | 'type' | 'punct' | 'tag' | 'property' | 'boolean'

export interface Token {
  text: string
  kind: TokenKind
}

// Appends `text` to `out`, merging into the previous token if it's also
// 'plain' — keeps consecutive unmatched characters as one token instead of
// one-per-character.
function pushPlain(out: Token[], text: string) {
  if (text.length === 0) return
  const last = out[out.length - 1]
  if (last && last.kind === 'plain') {
    last.text += text
  } else {
    out.push({ text, kind: 'plain' })
  }
}

function push(out: Token[], text: string, kind: TokenKind) {
  if (text.length === 0) return
  out.push({ text, kind })
}

// ---------------------------------------------------------------------------
// prisma

const PRISMA_KEYWORDS = /^(model|type|enum|view)\b/
const PRISMA_SCALARS = new Set([
  'String', 'Int', 'Float', 'Boolean', 'DateTime', 'Json', 'Bytes', 'BigInt', 'Decimal', 'ObjectId',
])

function highlightPrisma(code: string): Token[] {
  const out: Token[] = []
  let i = 0
  const n = code.length
  while (i < n) {
    const rest = code.slice(i)

    // line comment
    if (rest.startsWith('//')) {
      const end = code.indexOf('\n', i)
      const stop = end === -1 ? n : end
      push(out, code.slice(i, stop), 'comment')
      i = stop
      continue
    }

    // string literal
    if (code[i] === '"') {
      let j = i + 1
      while (j < n && code[j] !== '"') {
        if (code[j] === '\\') j++
        j++
      }
      if (j < n) j++ // consume closing quote
      push(out, code.slice(i, j), 'string')
      i = j
      continue
    }

    // number
    const numMatch = /^\d+(\.\d+)?/.exec(rest)
    if (numMatch) {
      push(out, numMatch[0], 'number')
      i += numMatch[0].length
      continue
    }

    // attribute: @@name or @name
    const attrMatch = /^@{1,2}[A-Za-z_][A-Za-z0-9_.]*/.exec(rest)
    if (attrMatch) {
      push(out, attrMatch[0], 'attr')
      i += attrMatch[0].length
      continue
    }

    // block keyword (whole word)
    const kwMatch = PRISMA_KEYWORDS.exec(rest)
    if (kwMatch && !isIdentChar(code[i - 1])) {
      push(out, kwMatch[0], 'keyword')
      i += kwMatch[0].length
      continue
    }

    // identifier: Capitalized (type) or scalar
    const identMatch = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest)
    if (identMatch) {
      const word = identMatch[0]
      const isCapitalized = /^[A-Z]/.test(word)
      if (PRISMA_SCALARS.has(word) || isCapitalized) {
        push(out, word, 'type')
      } else {
        pushPlain(out, word)
      }
      i += word.length
      continue
    }

    // punctuation
    if ('{}()[],:'.includes(code[i])) {
      push(out, code[i], 'punct')
      i += 1
      continue
    }

    pushPlain(out, code[i])
    i += 1
  }
  return out
}

function isIdentChar(c: string | undefined): boolean {
  return !!c && /[A-Za-z0-9_]/.test(c)
}

// ---------------------------------------------------------------------------
// latex / tikz

function highlightLatex(code: string): Token[] {
  const out: Token[] = []
  let i = 0
  const n = code.length
  while (i < n) {
    const rest = code.slice(i)

    // comment
    if (code[i] === '%') {
      const end = code.indexOf('\n', i)
      const stop = end === -1 ? n : end
      push(out, code.slice(i, stop), 'comment')
      i = stop
      continue
    }

    // command: \letters or \ + one non-letter (e.g. \\, \{, \%)
    if (code[i] === '\\') {
      const cmdMatch = /^\\[A-Za-z]+/.exec(rest)
      if (cmdMatch) {
        push(out, cmdMatch[0], 'keyword')
        i += cmdMatch[0].length
        continue
      }
      if (i + 1 < n) {
        push(out, code.slice(i, i + 2), 'keyword')
        i += 2
        continue
      }
      // trailing lone backslash
      pushPlain(out, code[i])
      i += 1
      continue
    }

    // punctuation
    if ('{}[]()'.includes(code[i])) {
      push(out, code[i], 'punct')
      i += 1
      continue
    }

    // number
    const numMatch = /^\d+(\.\d+)?/.exec(rest)
    if (numMatch) {
      push(out, numMatch[0], 'number')
      i += numMatch[0].length
      continue
    }

    pushPlain(out, code[i])
    i += 1
  }
  return out
}

// ---------------------------------------------------------------------------
// html

function highlightHtml(code: string): Token[] {
  const out: Token[] = []
  let i = 0
  const n = code.length
  while (i < n) {
    const rest = code.slice(i)

    // comment, possibly multiline
    if (rest.startsWith('<!--')) {
      const end = code.indexOf('-->', i)
      const stop = end === -1 ? n : end + 3
      push(out, code.slice(i, stop), 'comment')
      i = stop
      continue
    }

    // tag: </?name ...attrs.../?>
    if (code[i] === '<') {
      const tagMatch = /^<\/?[A-Za-z][A-Za-z0-9-]*/.exec(rest)
      if (tagMatch) {
        push(out, tagMatch[0], 'tag')
        i += tagMatch[0].length
        // scan attributes up to the closing '>' (or '/>')
        while (i < n && code[i] !== '>') {
          const attrRest = code.slice(i)
          if (/^\s/.test(code[i])) {
            pushPlain(out, code[i])
            i += 1
            continue
          }
          if (code[i] === '/') {
            push(out, '/', 'tag')
            i += 1
            continue
          }
          const attrNameMatch = /^[A-Za-z_:][A-Za-z0-9_:.-]*/.exec(attrRest)
          if (attrNameMatch) {
            push(out, attrNameMatch[0], 'attr')
            i += attrNameMatch[0].length
            // optional ` = "value" ` (allow surrounding whitespace around '=')
            let j = i
            while (j < n && /\s/.test(code[j])) j++
            if (code[j] === '=') {
              j += 1
              while (j < n && /\s/.test(code[j])) j++
              pushPlain(out, code.slice(i, j)) // the whitespace + '=' run itself
              i = j
              const quote = code[i]
              if (quote === '"' || quote === "'") {
                let k = i + 1
                while (k < n && code[k] !== quote) k++
                if (k < n) k++ // consume closing quote
                push(out, code.slice(i, k), 'string')
                i = k
              }
            }
            continue
          }
          // stray character inside the tag we don't recognize
          pushPlain(out, code[i])
          i += 1
        }
        if (i < n && code[i] === '>') {
          push(out, '>', 'tag')
          i += 1
        }
        continue
      }
    }

    // text between tags
    const nextLt = code.indexOf('<', i)
    const stop = nextLt === -1 ? n : nextLt
    if (stop === i) {
      // a '<' that didn't match a tag/comment above — treat as plain text
      pushPlain(out, code[i])
      i += 1
      continue
    }
    pushPlain(out, code.slice(i, stop))
    i = stop
  }
  return out
}

// ---------------------------------------------------------------------------
// json

function highlightJson(code: string): Token[] {
  const out: Token[] = []
  let i = 0
  const n = code.length
  while (i < n) {
    const rest = code.slice(i)

    if (code[i] === '"') {
      let j = i + 1
      while (j < n && code[j] !== '"') {
        if (code[j] === '\\') j++
        j++
      }
      if (j < n) j++ // consume closing quote
      const str = code.slice(i, j)
      // look ahead past whitespace for ':' to decide property vs string
      let k = j
      while (k < n && /\s/.test(code[k])) k++
      const isProperty = code[k] === ':'
      push(out, str, isProperty ? 'property' : 'string')
      i = j
      continue
    }

    const boolMatch = /^(true|false|null)\b/.exec(rest)
    if (boolMatch) {
      push(out, boolMatch[0], 'boolean')
      i += boolMatch[0].length
      continue
    }

    const numMatch = /^-?\d+(\.\d+)?([eE][+-]?\d+)?/.exec(rest)
    if (numMatch && numMatch[0].length > 0) {
      push(out, numMatch[0], 'number')
      i += numMatch[0].length
      continue
    }

    if ('{}[],:'.includes(code[i])) {
      push(out, code[i], 'punct')
      i += 1
      continue
    }

    pushPlain(out, code[i])
    i += 1
  }
  return out
}

// ---------------------------------------------------------------------------

export function highlight(code: string, lang: HighlightLang): Token[] {
  switch (lang) {
    case 'prisma': return highlightPrisma(code)
    case 'latex': return highlightLatex(code)
    case 'html': return highlightHtml(code)
    case 'json': return highlightJson(code)
  }
}
