'use client'

import type { ReactNode } from 'react'
import type { Color } from '../../domain/types'
import { CATEGORIES, swatchStyle } from '../rails'
import type { SelectionTarget } from '../Canvas'
import { CenteredPillRow } from './CenteredPillRow'

// General toolbar — the mockup's category Spine (DS .pill, scaled up),
// centred over the canvas. Most categories are placeholders; clicking
// "Shape" opens the forms toolbar directly below it.
//
// `second` is SecondToolbar's rendered output (or null) — passed in by
// Canvas and placed HERE, alongside the category pill, inside the same
// CenteredPillRow content element. It's the top pill that commands the
// lower one, not the other way around: the lower pill is positioned purely
// via CSS (position: absolute, anchored to this shared content box — see
// .toolbar-second-pill in globals.css) and has zero effect on the top
// pill's own position or this row's clamp.
export function MainToolbar({
  activeCategory, setActiveCategory, activeShapeSymbol, selectionTarget, colorInfo, activeColor, second,
}: {
  activeCategory: string
  setActiveCategory: (updater: (c: string) => string) => void
  activeShapeSymbol: string
  selectionTarget: SelectionTarget
  colorInfo: { shared: Color | undefined; isShared: boolean }
  activeColor: Color | null
  second?: ReactNode
}) {
  return (
    <CenteredPillRow top={16}>
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
      {second}
    </CenteredPillRow>
  )
}
