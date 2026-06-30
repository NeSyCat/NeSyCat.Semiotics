import type { CSSProperties } from 'react'

/**
 * Typed facade over the Admination Design System tokens (live-linked via the
 * `admination-design-system` dependency). Every value resolves to a DS token
 * via `var(--…)`. Light theme (DS :root default).
 */
const theme = {
  glass: {
    panelBg: 'var(--color-card)',
    buttonBg: 'var(--color-surface)',
    borderColor: 'var(--color-border)',
  },
  node: {
    accentBlue: '52, 120, 246', // DS --color-primary (#3478F6) as an R,G,B triple
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
    ink: '#111111', // solid near-black for canvas labels (the DS text is gray-800)
    muted: 'var(--color-muted-foreground)',
    dimmed: 'var(--color-muted-foreground)',
    shadow: 'none',
    shadowLight: 'none',
  },
  canvas: {
    background: '#ffffff', // pure white canvas (not the DS off-white --color-background)
    gridColor: 'rgba(0,0,0,0.06)',
  },
} as const

export function panelStyle(): CSSProperties {
  return {
    background: theme.glass.panelBg,
    border: `1px solid ${theme.glass.borderColor}`,
    boxShadow: 'var(--shadow-md)',
  }
}

export function selectionGlow(accent: string, selected: boolean, size: 'normal' | 'small' = 'normal'): CSSProperties {
  if (!selected) return { filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.12))' }
  const glow = size === 'small' ? `rgba(${accent}, 1)` : `rgba(${accent}, 0.7)`
  const soft = `rgba(${accent}, 0.3)`
  if (size === 'small') {
    return { filter: `drop-shadow(0 0 3px ${glow}) drop-shadow(0 0 8px ${glow})` }
  }
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

export default theme
