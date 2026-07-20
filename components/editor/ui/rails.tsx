import type { Shape, Color } from '../domain/types'
import { toCssRgb } from '../domain/color'

// Top Spine pill — the mockup's categories (exact symbols / value glyphs).
// Only "shape" opens a working second toolbar; the rest are placeholders.
// Direction/Weight/Order are disabled for now — kept out of this list so
// they don't render in the pill.
export const CATEGORIES: Array<{ key: string; label: string; content: React.ReactNode }> = [
  { key: 'scale', label: 'Scale', content: <svg aria-hidden="true"><use href="#ic-scale" /></svg> },
  { key: 'rotation', label: 'Rotation', content: <svg aria-hidden="true"><use href="#ic-rotation" /></svg> },
  { key: 'location', label: 'Location', content: <svg aria-hidden="true"><use href="#ic-location" /></svg> },
  // Static fallback content — actually rendered dynamically below (the pill
  // maps 'color' to a disk showing the selection's shared colour).
  { key: 'color', label: 'Color', content: <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'transparent', display: 'block' }} /> },
  { key: 'shape', label: 'Shape', content: <svg aria-hidden="true"><use href="#kind-hexagon" /></svg> },
  { key: 'name', label: 'Name', content: <span style={{ fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}>Aa</span> },
]

// Second toolbar — the Shape rail. Every tile sets the shape of the SELECTED
// POINT(S), and — since a point's glyph and a form's own shape share the
// SAME Shape vocabulary (types.ts) — the SAME `shape` field also transforms
// the selected FORM(S)/sets the create-tool default. The rail covers the
// full 5-member vocabulary, no disabled/legacy-only entries.
export const SHAPE_RAIL: Array<{ label: string; symbol: string; shape: Shape }> = [
  { label: 'Empty', symbol: 'kind-empty', shape: 'empty' },
  { label: 'Triangle', symbol: 'kind-triangle', shape: 'triangle' },
  { label: 'Rhombus', symbol: 'kind-rhombus', shape: 'rhombus' },
  { label: 'Circle', symbol: 'kind-circle', shape: 'circle' },
  { label: 'Square', symbol: 'kind-rectangle', shape: 'square' },
]

// Second toolbar — the Color rail. Applies to the SELECTION (points > forms >
// lines, same priority as the Name field). Hues are HSL 0/30/60/120/180/210/
// 240/300 at 100% S, 50% L, per spec; White closes out the row. White IS the
// default: it maps to `null`, clearing the target back to the undefined
// default (transparent form fill / ink glyphs / black lines) — an uncolored
// target reads as White in the rail and the top-pill icon.
export const COLOR_RAIL: Array<{ label: string; color: Color | null }> = [
  { label: 'Red', color: [1, 0, 0] },
  { label: 'Orange', color: [1, 0.5, 0] },
  { label: 'Yellow', color: [1, 1, 0] },
  { label: 'Green', color: [0, 1, 0] },
  { label: 'Cyan', color: [0, 1, 1] },
  { label: 'Azure', color: [0, 0.5, 1] },
  { label: 'Blue', color: [0, 0, 1] },
  { label: 'Magenta', color: [1, 0, 1] },
  { label: 'White', color: null },
]

// Value-compares two colors — null/undefined both mean the White default and
// count as equal, so a mixed selection of one never-coloured form and one
// White-reset point still reads as a shared default state.
export function sameColor(a: Color | null | undefined, b: Color | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

// Shared disk styling for both the Color-rail swatches and the top-pill
// Color icon — no color means the White default, so the disk is never
// anything but a plain color. `active` swaps the inset ring to white so it
// stays visible against the .is-active button's primary-blue fill.
export function swatchStyle(color: Color | null | undefined, active: boolean, size: number): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'block',
    background: color ? toCssRgb(color) : '#ffffff',
    boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.85)' : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
  }
}
