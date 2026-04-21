import type { CSSProperties } from 'react'

const theme = {
  glass: {
    blur: 3,
    panelBg: 'rgba(15,15,20,0.4)',
    buttonBg: 'rgba(255,255,255,0.06)',
    borderColor: 'rgba(255,255,255,0.08)',
  },

  node: {
    accentBlue: '59,130,246',
    fillOpacity: 0.18,
    borderOpacity: 0.35,
    selectedFillOpacity: 0.35,
    selectedBorderOpacity: 0.7,
  },

  fontSize: 16,
  smallFontSize: 14,

  text: {
    primary: '#fff',
    secondary: 'rgba(255,255,255,0.8)',
    muted: 'rgba(255,255,255,0.55)',
    dimmed: 'rgba(255,255,255,0.35)',
    shadow: '0 1px 3px rgba(0,0,0,0.5)',
    shadowLight: '0 1px 2px rgba(0,0,0,0.3)',
  },

  canvas: {
    background: '#0f0f14',
    gridColor: 'rgba(255,255,255,0.03)',
  },
} as const

export function glassBlur(): CSSProperties {
  return {
    backdropFilter: `blur(${theme.glass.blur}px)`,
    WebkitBackdropFilter: `blur(${theme.glass.blur}px)`,
  }
}

export function panelStyle(): CSSProperties {
  return {
    background: theme.glass.panelBg,
    ...glassBlur(),
    border: `1px solid ${theme.glass.borderColor}`,
  }
}

export function injectThemeVars(): void {
  const root = document.documentElement
  root.style.setProperty('--glass-blur', `blur(${theme.glass.blur}px)`)
  root.style.setProperty('--glass-panel-bg', theme.glass.panelBg)
  root.style.setProperty('--glass-button-bg', theme.glass.buttonBg)
  root.style.setProperty('--glass-border', theme.glass.borderColor)
  root.style.setProperty('--text-secondary', theme.text.secondary)
  root.style.setProperty('--canvas-bg', theme.canvas.background)
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
