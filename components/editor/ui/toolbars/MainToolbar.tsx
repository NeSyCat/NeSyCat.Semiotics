'use client'

import type { Color } from '../../domain/types'
import { CATEGORIES, swatchStyle } from '../rails'
import type { SelectionTarget } from '../Canvas'

// General toolbar — the mockup's category Spine (DS .pill, scaled up),
// centred over the canvas. Most categories are placeholders; clicking
// "Shape" opens the forms toolbar directly below it.
export function MainToolbar({
  activeCategory, setActiveCategory, activeShapeSymbol, selectionTarget, colorInfo, activeColor,
}: {
  activeCategory: string
  setActiveCategory: (updater: (c: string) => string) => void
  activeShapeSymbol: string
  selectionTarget: SelectionTarget
  colorInfo: { shared: Color | undefined; isShared: boolean }
  activeColor: Color | null
}) {
  return (
    <div style={{ position: 'absolute', top: 16, left: 'calc(50% + (var(--sidebar-offset, 0px) / 2))', transform: 'translateX(-50%)', zIndex: 10, transition: 'left 200ms' }}>
      <div className="pill editor-pill" role="toolbar" aria-label="Categories">
        {CATEGORIES.map((cat) => (
          <button
            key={cat.key}
            className={`btn btn-icon${cat.key === activeCategory ? ' is-active' : ''}`}
            title={cat.label}
            onClick={() => setActiveCategory((c) => (c === cat.key ? '' : cat.key))}
          >
            {cat.key === 'shape'
              ? <svg aria-hidden="true"><use href={`#${activeShapeSymbol}`} /></svg>
              : cat.key === 'color'
                ? <span style={swatchStyle(selectionTarget ? (colorInfo.isShared ? colorInfo.shared : undefined) : activeColor, cat.key === activeCategory, 16)} />
                : cat.content}
          </button>
        ))}
      </div>
    </div>
  )
}
