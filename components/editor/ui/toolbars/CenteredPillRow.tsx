'use client'

import type { ReactNode } from 'react'

// Shared positioning shell for the centered pill stack — MainToolbar's
// category spine (always) stacked above SecondToolbar's conditional rail/
// field (when a category is active). Both used to position via a bare
// `left: calc(50% + var(--sidebar-offset, 0px) / 2)` + translateX(-50%) —
// correct when there's room, but with the sidebar open and/or the widest
// SecondToolbar rows (the Color rail) it could push the pill's right edge
// under TopRightPills. A later fix (9914d94) centered each row within its
// OWN flex TRACK, but that meant MainToolbar and SecondToolbar clamped
// independently — different content widths hit their clamp onset at
// different viewport widths, so under tight space the wider row (e.g. the
// Name field) yielded left more than the narrower one and the two pills
// lost their shared center.
//
// Now there is ONE flex track (one CenteredPillRow instance, rendered once
// from Canvas) bounded by a left spacer (carrying the sidebar bias) and a
// right spacer whose `min-width` reserves TopRightPills' measured width
// (--topright-width, set by TopRightPills itself) + a gap — so when space
// is tight the right spacer hits its floor and ALL remaining space
// collapses onto the left spacer, pushing the pill leftward instead of
// letting it slide under the right cluster. When there's room, both
// spacers grow equally past their floors and the pill lands exactly where
// the old calc put it — no full-width regression.
//
// The track's CONTENT is a flex COLUMN of children (MainToolbar's pill,
// then optionally SecondToolbar's pill) with `align-items: center` — the
// WIDEST child drives the column's intrinsic width, which is what the
// track clamps against, and every child shares that column's center by
// construction, so the two pills can never drift apart. When SecondToolbar
// renders nothing, the column has a single child and is pixel-identical to
// the old main-only row.
//
// pointer-events: the column itself stays `none` (like the spacers) so the
// dead space around a narrower child and the vertical gap between children
// never swallow canvas clicks; each direct child (a real pill) re-enables
// `auto` for itself — see `.toolbar-center-content` / `> *` in globals.css.
export function CenteredPillRow({ top, children }: { top: number; children: ReactNode }) {
  return (
    <div className="toolbar-center-row" style={{ top }}>
      <div className="toolbar-center-spacer is-left" aria-hidden="true" />
      <div className="toolbar-center-content">{children}</div>
      <div className="toolbar-center-spacer is-right" aria-hidden="true" />
    </div>
  )
}

