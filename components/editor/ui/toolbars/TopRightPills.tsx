'use client'

import type { ReactNode } from 'react'
import type { Diagram } from '../../domain/types'
import { ExportMenu } from '../ExportMenu'

// Top-right pill cluster: [grid + points-visibility] [import/export]
// [topRight — the auth/share pill], in that left-to-right order (the
// cluster itself is right-anchored; import/export sits immediately LEFT of
// the share pill, mirroring quiver's round-trip idiom).
export function TopRightPills({
  gridEnabled, toggleGridEnabled, pointsVisible, togglePointsVisible, diagram, onImportClick, topRight,
}: {
  gridEnabled: boolean; toggleGridEnabled: () => void
  pointsVisible: boolean; togglePointsVisible: () => void
  diagram: Diagram
  onImportClick: () => void
  topRight?: ReactNode
}) {
  return (
    <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
      <div className="pill-cluster">
        <div className="pill editor-pill">
          <button
            className={`btn btn-icon${gridEnabled ? ' is-active' : ''}`}
            title={gridEnabled ? 'Hide grid & disable snapping' : 'Show grid & snap to grid'}
            aria-label={gridEnabled ? 'Hide grid & disable snapping' : 'Show grid & snap to grid'}
            onClick={toggleGridEnabled}
          >
            <svg aria-hidden="true"><use href="#ic-grid" /></svg>
          </button>
          <button
            className={`btn btn-icon${pointsVisible ? '' : ' is-active'}`}
            title={pointsVisible ? 'Hide point names' : 'Show point names'}
            aria-label={pointsVisible ? 'Hide point names' : 'Show point names'}
            onClick={togglePointsVisible}
          >
            <svg aria-hidden="true"><use href={`#${pointsVisible ? 'ic-eye' : 'ic-eye-off'}`} /></svg>
          </button>
        </div>
        {/* Round trip: Import (paste a share link OR TikZ this editor
            exported, opens a paste panel) on the left, Export (a Copy
            URL / Copy TikZ code dropdown — minimalist, no code preview)
            on the right — one pill, mirrored icons. */}
        {/* position:relative lives HERE (the whole pill), not on ExportMenu's
            own inner wrapper — the dropdown's `right: 0` needs to align with
            the PILL's right edge, not just the Export button's slightly-
            inset flex-item box, or it reads as sitting too far left. */}
        <div className="pill editor-pill" style={{ position: 'relative' }}>
          <button
            className="btn btn-icon"
            title="Import from link or TikZ"
            aria-label="Import from link or TikZ"
            onClick={onImportClick}
          >
            <svg aria-hidden="true"><use href="#ic-import" /></svg>
          </button>
          <ExportMenu diagram={diagram} />
        </div>
        {topRight}
      </div>
    </div>
  )
}
