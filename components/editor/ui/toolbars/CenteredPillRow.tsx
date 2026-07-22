'use client'

import type { ReactNode } from 'react'

// Shared positioning shell for the centered pill clusters — now used ONLY by
// MainToolbar's category spine (the top pill). It used to position via a
// bare `left: calc(50% + var(--sidebar-offset, 0px) / 2)` + translateX(-50%)
// — correct when there's room, but with the sidebar open and/or a wide pill
// it could push the pill's right edge under TopRightPills. This centers
// within a flex TRACK bounded by a left spacer (carrying the sidebar bias)
// and a right spacer whose `min-width` reserves TopRightPills' measured
// width (--topright-width, set by TopRightPills itself) + a gap — so when
// space is tight the right spacer hits its floor and ALL remaining space
// collapses onto the left spacer, pushing the pill leftward instead of
// letting it slide under the right cluster. When there's room, both spacers
// grow equally past their floors and the pill lands exactly where the old
// calc put it — no full-width regression.
//
// The second pill (SecondToolbar) is no longer a sibling row with its own
// clamp — it renders as an absolutely-positioned CHILD of `.toolbar-center-
// content` (see MainToolbar, which passes it in as `children` alongside its
// own pill). Being out-of-flow, it contributes zero width to this row's
// clamp math (its own width can never move the top pill), while being
// anchored to the SAME content element means it inherits the top pill's
// sidebar-shift/clamp position automatically, including mid-transition —
// no measurement, no ResizeObserver, just position: absolute tracking a
// translated ancestor.
export function CenteredPillRow({ top, children }: { top: number; children: ReactNode }) {
  return (
    <div className="toolbar-center-row" style={{ top }}>
      <div className="toolbar-center-spacer is-left" aria-hidden="true" />
      <div className="toolbar-center-content">{children}</div>
      <div className="toolbar-center-spacer is-right" aria-hidden="true" />
    </div>
  )
}
