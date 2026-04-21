import type { CSSProperties } from 'react'

/**
 * Typed facade over the design tokens in app/globals.css.
 *
 * Fields that exist as CSS variables resolve via `var(--…)` — globals.css is
 * the single source of truth. Fields unique to TS (node opacities, font sizes,
 * text shadows, the SVG grid color that can't consume CSS vars) are literals
 * here and nowhere else.
 */
const theme = {
  glass: {
    blur: 'var(--effect-blur)',
    panelBg: 'var(--color-glass-panel-bg)',
    buttonBg: 'var(--color-glass-button-bg)',
    borderColor: 'var(--color-glass-border)',
  },

  node: {
    // R,G,B triple so consumers can splice opacity: rgba(var(--color-accent-rgb), 0.5)
    accentBlue: 'var(--color-accent-rgb)',
    fillOpacity: 0.18,
    borderOpacity: 0.35,
    selectedFillOpacity: 0.35,
    selectedBorderOpacity: 0.7,
  },

  fontSize: 16,
  smallFontSize: 14,

  text: {
    primary: 'var(--color-text-primary)',
    secondary: 'var(--color-text-secondary)',
    muted: 'var(--color-text-muted)',
    dimmed: 'var(--color-text-dimmed)',
    shadow: '0 1px 3px rgba(0,0,0,0.5)',
    shadowLight: '0 1px 2px rgba(0,0,0,0.3)',
  },

  canvas: {
    background: 'var(--color-canvas-bg)',
    // Passed as an SVG `fill` attribute to React Flow's <Background>, which
    // doesn't resolve CSS custom properties in SVG presentation attrs.
    gridColor: 'rgba(255,255,255,0.03)',
  },
} as const

export function glassBlur(): CSSProperties {
  return {
    backdropFilter: `blur(${theme.glass.blur})`,
    WebkitBackdropFilter: `blur(${theme.glass.blur})`,
  }
}

export function panelStyle(): CSSProperties {
  return {
    background: theme.glass.panelBg,
    ...glassBlur(),
    border: `1px solid ${theme.glass.borderColor}`,
  }
}

export function selectionGlow(accent: string, selected: boolean, size: 'normal' | 'small' = 'normal'): CSSProperties {
  if (!selected) return { filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.2))' }
  const glow = size === 'small' ? `rgba(${accent}, 1)` : `rgba(${accent}, 0.7)`
  const soft = `rgba(${accent}, 0.3)`
  if (size === 'small') {
    return { filter: `drop-shadow(0 0 3px ${glow}) drop-shadow(0 0 8px ${glow})` }
  }
  // Normal size: radiate outward to the 2×-shape selection frame (≈ nodeSize/2
  // ≈ 100px from the shape edge). Layered drop-shadows build a gradient from
  // tight core → far reach; keyframe animation pulses both the inner glow
  // and the outer soft halo via --glow / --soft.
  const base =
    `drop-shadow(0 0 4px ${glow}) ` +
    `drop-shadow(0 0 16px ${glow}) ` +
    `drop-shadow(0 0 40px ${glow}) ` +
    `drop-shadow(0 0 80px ${soft})`
  return {
    '--glow': glow,
    '--soft': soft,
    filter: base,
    animation: 'glow-radiate 2s ease-in-out infinite',
  } as CSSProperties
}

export function pointDotStyle(accent: string, selected: boolean): CSSProperties {
  return {
    background: selected ? `rgba(${accent}, 1)` : `rgba(${accent}, 0.8)`,
    width: 12,
    height: 12,
    border: 'none',
    transition: 'background 0.12s ease, filter 0.15s ease',
    ...selectionGlow(accent, selected, 'small'),
  }
}

export default theme
