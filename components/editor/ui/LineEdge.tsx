'use client'

import { memo, useMemo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  ViewportPortal,
  type EdgeProps,
} from '@xyflow/react'
import theme from './theme'
import { useStore } from '../state/store'
import { Tex } from './Tex'
import { toRgbTriple } from '../domain/color'
import { wirePath, type Dir } from '../domain/wirepath'
import type { Color } from '../domain/types'

interface LineEdgeData {
  // Undefined on every segment past the first of a multi-target line — see
  // Canvas.tsx's builtEdges: a hyperedge's name/id renders ONCE per line
  // (first segment only), not per-segment. LineEdge renders neither the text
  // nor its canvas-colored mask when this is unset.
  label?: string
  color?: Color
  // Each endpoint's TRUE outward wire-tangent — domain/forms.ts's
  // worldPointNormal (the form's own per-shape edge/arc perpendicular,
  // rotated by the form's own rotation), computed by Canvas.tsx's builtEdges
  // (pointWorldNormal) and handed straight to wirePath below. null for a
  // free end (a 'self'-edgeKey empty-form point — worldPointNormal itself
  // already returns null there) — wirePath reads that as "leave straight
  // toward the other endpoint" (bezier) / "no stub, turn exactly at this
  // point" (smoothstep). NOT derived from sourcePosition/targetPosition
  // (React Flow's own Position enum) any more — that's a coarse, STATIC
  // per-edgeKey cardinal, wrong for a slanted triangle edge and blind to
  // form.rotation entirely.
  sourceDir?: Dir
  targetDir?: Dir
  // True for a hyperedge branch (line.targets.length > 1) — set by
  // Canvas.tsx's builtEdges off the SAME line, shared by every one of its
  // segments. Routes the smoothstep elbow at the shared source (wirepath.ts's
  // ElbowPlacement 'source') instead of centered ('mid'), so every branch's
  // cross-axis run starts from the same point rather than all landing on one
  // coincident "trunk" that smears the split and hides the copy point.
  // Mirrored in ir/geometry-ir.ts's buildLineCmds for export parity.
  hyper?: boolean
}

function LineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const d = data as unknown as LineEdgeData
  const style = useStore((s) => s.diagram.edgeStyle ?? 'straight')
  const hovered = useStore((s) => s.hoveredEdgeId === id)

  // The wire goes straight to the TRUE anchor — no endpoint pull-back.
  // Where a point glyph or point name sits on top of it, the wire is merely
  // HIDDEN underneath (PointVisual's opaque glyph fill / canvas-colored name
  // mask; React Flow renders nodes above edges), never geometrically
  // deformed to dodge them — matching export/geometry-ir.ts's buildLineCmds,
  // which has always used the raw point positions with no gap of its own.
  const sx = sourceX, sy = sourceY, tx = targetX, ty = targetY

  // Canvas.tsx's builtEdges already resolved each endpoint's TRUE tangent
  // (domain/forms.ts's worldPointNormal) — used AS-IS, no conversion needed.
  const sDir: Dir = d.sourceDir ?? null
  const tDir: Dir = d.targetDir ?? null
  const { d: edgePath, mid } = wirePath(sx, sy, sDir, tx, ty, tDir, style, d.hyper ? 'source' : 'mid')
  const labelX = mid.x
  const labelY = mid.y

  const lineColor = d.color ? `rgb(${toRgbTriple(d.color)})` : '#000000' // no colour → black
  const edgeStyle = useMemo(
    () => ({
      stroke: lineColor, // wire always keeps its own color — selection is shown via the band, not a stroke swap
      strokeWidth: 1.5,
      transition: 'stroke 0.15s ease',
    }),
    [lineColor],
  )

  // Hover/selection tint — the DS interaction tokens, same as the forms' zones.
  const tint = selected ? 'var(--color-selected)' : hovered ? 'var(--color-hover)' : null

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={edgeStyle} />
      {/* Hover/selection band — a translucent grey sweep along the whole wire,
          invisible until the wire is hovered (store.hoveredEdgeId) or selected.
          Rendered in the ViewportPortal, the topmost viewport layer, so it
          draws straight through the line/point name masks (which live in lower
          layers and exist only to keep the wire's dashes from striking through
          the text). Same tint idiom as forms' quiver-style zones. */}
      <ViewportPortal>
        <svg
          aria-hidden="true"
          width="1"
          height="1"
          // zIndex 1001: React Flow elevates SELECTED nodes to z 1000, which
          // would otherwise lift their point-name masks back over the band.
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 1001 }}
        >
          <path
            d={edgePath}
            className="line-band"
            fill="none"
            strokeWidth={14}
            strokeLinecap="round"
            style={{ stroke: tint ?? 'transparent', transition: 'stroke 0.15s ease' }}
          />
        </svg>
      </ViewportPortal>
      {d.label != null && (
        <EdgeLabelRenderer>
          {/* Read-only LaTeX label (edited only in the Name field). No box — just a
              small canvas-coloured mask so the line doesn't strike through it. The
              hover/selection band paints OVER this mask (viewport portal), so the
              highlight passes through the name without a gap. */}
          <div
            className="nodrag nopan"
            style={{
              position: 'absolute',
              transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
              pointerEvents: 'none',
              background: theme.canvas.background,
              padding: '0 5px',
            }}
          >
            <Tex fontSize={16} color={theme.text.ink}>{d.label}</Tex>
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
}

export default memo(LineEdge)
