'use client'

import type { ReactNode } from 'react'

// Shared positioning shell for the centered pill clusters (MainToolbar's
// category spine, SecondToolbar's rail/field). Both used to position via a
// bare `left: calc(50% + var(--sidebar-offset, 0px) / 2)` + translateX(-50%)
// — correct when there's room, but with the sidebar open and/or the widest
// SecondToolbar rows (the Color rail) it could push the pill's right edge
// under TopRightPills. This centers within a flex TRACK bounded by a left
// spacer (carrying the sidebar bias) and a right spacer whose `min-width`
// reserves TopRightPills' measured width (--topright-width, set by
// TopRightPills itself) + a gap — so when space is tight the right spacer
// hits its floor and ALL remaining space collapses onto the left spacer,
// pushing the pill leftward instead of letting it slide under the right
// cluster. When there's room, both spacers grow equally past their floors
// and the pill lands exactly where the old calc put it — no full-width
// regression.
export function CenteredPillRow({ top, children }: { top: number; children: ReactNode }) {
  return (
    <div className="toolbar-center-row" style={{ top }}>
      <div className="toolbar-center-spacer is-left" aria-hidden="true" />
      <div className="toolbar-center-content">{children}</div>
      <div className="toolbar-center-spacer is-right" aria-hidden="true" />
    </div>
  )
}
