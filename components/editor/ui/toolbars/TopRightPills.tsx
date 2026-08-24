'use client'

import type { ReactNode } from 'react'
import { useEffect, useRef } from 'react'
import { WireStyleMenu } from './WireStyleMenu'
import type { EdgeStyle } from '../../domain/wirepath'

// Top-right pill cluster: [grid + points-visibility + wire-style] [import/
// export] [topRight — the auth/share pill], in that left-to-right order (the
// cluster itself is right-anchored; import/export sits immediately LEFT of
// the share pill, mirroring quiver's round-trip idiom).
export function TopRightPills({
  gridEnabled, toggleGridEnabled, pointsVisible, togglePointsVisible, edgeStyle, setEdgeStyle, onImportClick, onExportClick, topRight,
}: {
  gridEnabled: boolean; toggleGridEnabled: () => void
  pointsVisible: boolean; togglePointsVisible: () => void
  edgeStyle: EdgeStyle; setEdgeStyle: (style: EdgeStyle) => void
  onImportClick: () => void
  onExportClick: () => void
  topRight?: ReactNode
}) {
  // Exposes this cluster's rendered width as --topright-width, mirroring how
  // EditorSidebar exposes --sidebar-offset — CenteredPillRow (MainToolbar/
  // SecondToolbar) reserves this much + a gap on its right so the centered
  // pill can never slide under this cluster. `topRight` (the auth pill)
  // varies signed-in vs signed-out, so the width can't be a static constant.
  // Pure DOM mutation (not React state), so no render-loop risk.
  const clusterRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = clusterRef.current
    if (!el) return
    const root = document.documentElement
    const update = () => root.style.setProperty('--topright-width', `${el.getBoundingClientRect().width}px`)
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { ro.disconnect(); root.style.removeProperty('--topright-width') }
  }, [])

  return (
    <div ref={clusterRef} style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
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
          <WireStyleMenu edgeStyle={edgeStyle} setEdgeStyle={setEdgeStyle} />
        </div>
        {/* Round trip: Import (paste a share link OR TikZ this editor
            exported, opens a paste panel) on the left, Export (opens the
            right-edge slide-in code panel) on the right — one pill,
            mirrored icons. */}
        <div className="pill editor-pill">
          <button
            className="btn btn-icon"
            title="Import from link or TikZ"
            aria-label="Import from link or TikZ"
            onClick={onImportClick}
          >
            <svg aria-hidden="true"><use href="#ic-import" /></svg>
          </button>
          <button className="btn btn-icon" title="Export" aria-label="Export" onClick={onExportClick}>
            <svg aria-hidden="true"><use href="#ic-export" /></svg>
          </button>
        </div>
        {topRight}
      </div>
    </div>
  )
}
