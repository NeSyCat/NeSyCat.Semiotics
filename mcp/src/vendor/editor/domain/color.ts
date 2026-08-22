// VENDORED COPY — verbatim from `domain/color.ts` (repo root), NOT a live relative
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

import type { Color } from './types'

// Default colour for new forms/points — the Admination DS primary
// (--color-primary, #3478F6 = rgb(52, 120, 246)). User-editable per shape.
export const DEFAULT_COLOR: Color = [52 / 255, 120 / 255, 246 / 255]

function chan(c: number): number {
  return Math.round(c * 255)
}

// "r, g, b" — splice into rgba(${triple}, alpha) at call sites.
export function toRgbTriple(c: Color): string {
  return `${chan(c[0])}, ${chan(c[1])}, ${chan(c[2])}`
}

export function toCssRgb(c: Color): string {
  return `rgb(${toRgbTriple(c)})`
}

export function toCssRgba(c: Color, alpha: number): string {
  return `rgba(${toRgbTriple(c)}, ${alpha})`
}
