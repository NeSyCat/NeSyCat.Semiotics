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
