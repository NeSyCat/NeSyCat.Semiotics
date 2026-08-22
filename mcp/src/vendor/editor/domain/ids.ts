// VENDORED COPY — verbatim from `domain/ids.ts` (repo root), NOT a live relative
// import. The app root has no "type":"module" in its package.json, so when
// this mcp package (own package.json has "type":"module") tries to
// cross-import these files by relative path at runtime, Node's ESM loader
// resolves THEIR module format by walking up from their own location (the
// app root, CommonJS) rather than from mcp/ — the resulting CJS transpile
// of a .ts file loaded via tsx is then subject to cjs-module-lexer's static
// named-export detection, which is unreliable across these files (confirmed
// empirically: some named imports resolved, others silently came back
// undefined). Copying the file into mcp/'s own ESM module graph sidesteps
// that boundary entirely — this is a byte-for-byte copy of the logic below
// (see the one documented exception in domain/forms.ts), not a
// reimplementation. Keep in sync by hand if the source file changes.

import type { Diagram } from './types'

// Role-prefixed numbered ids: forms F1.., points P1.., lines L1..
function nextNumberedId(taken: Iterable<string>, prefix: string): string {
  const re = new RegExp(`^${prefix}(\\d+)$`)
  let max = 0
  for (const id of taken) {
    const m = id.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return `${prefix}${max + 1}`
}

export function newFormId(d: Diagram): string {
  return nextNumberedId(d.forms.map((f) => f.id), 'F')
}

export function newPointId(d: Diagram): string {
  return nextNumberedId(Object.keys(d.points), 'P')
}

export function newLineId(d: Diagram): string {
  return nextNumberedId(d.lines.map((l) => l.id), 'L')
}
