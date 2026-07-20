'use client'

import type { CSSProperties } from 'react'
import theme from './theme'
import type { Body } from '../domain/forms'

// The ONE shared "how does a Shape paint itself" implementation. A form's
// own body (FormNode.tsx's BodyView, at node size) and a point's glyph
// (PointVisual.tsx's PointGlyph, at POINT_SIZE) both render through this —
// border stroke, fill/tint state, and per-Shape geometry are defined exactly
// once, not duplicated. Geometry itself is ALSO shared, not re-derived: a
// point's glyph reuses geometryFor(pt.shape).body straight from the domain
// registry — the SAME outline a form of that shape draws — so "a point
// looks exactly like a miniature form body" is structural, not coincidental
// (see PointVisual.tsx's PointGlyph).

// The shared BASE fill rule — an explicit color always wins (tinted at
// fillOpacity, boosted to selectedFillOpacity when selected — REPLACING the
// opacity in place, same accent color throughout), otherwise selected paints
// a flat neutral tint and idle+uncolored is fully transparent (the shape's
// interior genuinely shows whatever is behind it). `opacityScale` lets a
// form's own bodyOpacity (0 for 'empty') scale the color-tint step; point
// glyphs never use it (always the default 1).
//
// Deliberately does NOT take a `hovered` flag: unlike selection (which
// replaces this fill's own opacity), hover COMPOSITES a flat neutral tint ON
// TOP of whatever this returns — see FormNode.tsx's CenterOverlay, a
// SEPARATE layer painted over BodyView's fill regardless of that fill's own
// color/opacity. A single rgba string can't represent "translucent gray
// blended over an arbitrary color underneath" — that needs two stacked
// layers, not one formula — so every hover-capable caller renders a SECOND
// <ShapeBody> (fill: theme.node.regionHover, strokeWidth: 0) on top of the
// one built from this function instead of asking this function to account
// for hover itself (PointVisual.tsx's PointGlyph does exactly this).
export function tintFill(accent: string | null, selected: boolean, opacityScale: number = 1): string {
  if (accent) {
    const opacity = (selected ? theme.node.selectedFillOpacity : theme.node.fillOpacity) * opacityScale
    return `rgba(${accent}, ${opacity})`
  }
  return selected ? theme.node.regionSelected : 'transparent'
}

// A resident point glyph a form body's border/fill must NOT draw underneath
// (see gapPoints below) — its own position (node-space px) and radius.
export interface GapPoint {
  x: number
  y: number
  r: number
}

// Padding past a shape's own 0..n box for the gap mask's backing rect. A
// polygon's stroke straddles its path (half OUTSIDE it — 0.75px for a 1.5px
// stroke), and a square/rhombus/circle's own vertices sit exactly ON that
// 0..n boundary. An unpadded 0..n mask rect would clip that outer half of
// the stroke off wherever the path touches the box edge, visibly thinning
// the WHOLE border the instant any mask is applied — not just at the gapped
// points. This margin covers the overhang with headroom to spare.
const MASK_MARGIN = 4

export interface ShapeBodyProps {
  body: Body
  n: number
  fill: string
  // 0 = no border at all — an 'empty' point's transient hover/select
  // indicator has no glyph geometry of its own to outline.
  strokeWidth?: number
  // A form's own bodyOpacity (0 makes 'empty' forms' border invisible);
  // point glyphs never pass this (always the default, fully-opaque 1).
  borderOpacity?: number
  // Resident point glyphs to punch out of THIS body's border/fill — forms
  // only; point glyphs never gap themselves.
  gapPoints?: ReadonlyArray<GapPoint>
  maskId?: string
  // Extra style merged onto the wrapping <svg> — e.g. pointerEvents:none for
  // a form body with an always-present DragHandleZone fallback.
  style?: CSSProperties
}

// Renders `body` (a domain FormGeometry's polygon/circle outline) at n×n,
// filled with `fill` and bordered `strokeWidth`px solid black, optionally
// gapped around `gapPoints`.
export function ShapeBody({ body, n, fill, strokeWidth = 1.5, borderOpacity = 1, gapPoints = [], maskId, style }: ShapeBodyProps) {
  const border = strokeWidth > 0 ? `rgba(0, 0, 0, ${borderOpacity})` : 'none'
  const transition = { transition: 'fill 0.15s ease, stroke 0.15s ease' } as const

  // Luminance mask: a white backing rect (everything visible) with a black
  // circle punched at each gap point (invisible there) — shared by fill AND
  // stroke at once (one <mask> covers the whole painted shape), so they gap
  // identically. Skipped entirely when there's nothing to gap.
  const mask = gapPoints.length > 0 && maskId ? (
    <mask id={maskId} maskUnits="userSpaceOnUse" x={-MASK_MARGIN} y={-MASK_MARGIN} width={n + 2 * MASK_MARGIN} height={n + 2 * MASK_MARGIN}>
      <rect x={-MASK_MARGIN} y={-MASK_MARGIN} width={n + 2 * MASK_MARGIN} height={n + 2 * MASK_MARGIN} fill="white" />
      {gapPoints.map((p, i) => <circle key={i} cx={p.x} cy={p.y} r={p.r} fill="black" />)}
    </mask>
  ) : null
  const maskAttr = mask ? { mask: `url(#${maskId})` } : {}

  if (body.type === 'circle') {
    // r inset by half the stroke width so the stroke's OUTER edge lands
    // exactly at n/2 — the shape spans its full n×n box edge to edge, same
    // convention a form's own node box uses.
    const r = n / 2 - strokeWidth / 2
    return (
      <svg width={n} height={n} style={{ position: 'absolute', inset: 0, overflow: 'visible', ...style }}>
        {mask && <defs>{mask}</defs>}
        <circle cx={n / 2} cy={n / 2} r={r} fill={fill} stroke={border} strokeWidth={strokeWidth} style={transition} {...maskAttr} />
      </svg>
    )
  }
  const polyPts = body.pointsFrac.map(([x, y]) => `${x * n},${y * n}`).join(' ')
  return (
    <svg width={n} height={n} style={{ position: 'absolute', inset: 0, overflow: 'visible', ...style }}>
      {mask && <defs>{mask}</defs>}
      <polygon points={polyPts} fill={fill} stroke={border} strokeWidth={strokeWidth} style={transition} {...maskAttr} />
    </svg>
  )
}
