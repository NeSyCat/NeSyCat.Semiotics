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
import { wirePath, dirFromCardinal } from '../domain/wirepath'
import type { Color } from '../domain/types'

interface LineEdgeData {
  // Undefined on every segment past the first of a multi-target line — see
  // Canvas.tsx's builtEdges: a hyperedge's name/id renders ONCE per line
  // (first segment only), not per-segment. LineEdge renders neither the text
  // nor its canvas-colored mask when this is unset.
  label?: string
  color?: Color
  // Radius (px, flow space) to pull each end of the drawn path back by, so it
  // stops at the edge of a resident point's glyph instead of running through
  // its center — 0 when that end's point renders no glyph (shape 'empty').
  // Set by Canvas.tsx's builtEdges from POINT_SIZE/2 (domain/forms.ts), the
  // SAME radius BodyView gaps a form's border by, so a wire and the border it
  // crosses stop at the identical boundary. Approximation: computed along the
  // STRAIGHT line between the raw endpoints even in 'smoothstep' mode, where
  // the actual path may leave each endpoint in a different direction — close
  // enough at the pull-back distances involved (~14px).
  sourceGap?: number
  targetGap?: number
  // True when that end's point sits on an 'empty' form's 'self' edgeKey (its
  // one middle point) — set by Canvas.tsx's builtEdges. That point's
  // anchor.position is a fixed Position.Bottom picked purely for label
  // placement (domain/forms.ts's emptyGeometry), not a meaningful outward
  // wire direction, so it must NOT feed wirepath.ts's Dir the way every
  // other point's Position does — it's a free end (Dir null), which leaves
  // the wire straight toward the other endpoint instead of dipping down.
  sourceFree?: boolean
  targetFree?: boolean
}

// Pulls (sx,sy)/(tx,ty) toward each other along their own straight line by
// gs/gt respectively — capped at half the total distance each, so two large
// gaps on a very short wire can't cross past one another.
function shrinkEndpoints(sx: number, sy: number, tx: number, ty: number, gs: number, gt: number) {
  const dx = tx - sx
  const dy = ty - sy
  const len = Math.hypot(dx, dy) || 1
  const ux = dx / len
  const uy = dy / len
  const s = Math.min(gs, len / 2)
  const t = Math.min(gt, len / 2)
  return { sx: sx + ux * s, sy: sy + uy * s, tx: tx - ux * t, ty: ty - uy * t }
}

function LineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const d = data as unknown as LineEdgeData
  const style = useStore((s) => s.diagram.edgeStyle ?? 'straight')
  const hovered = useStore((s) => s.hoveredEdgeId === id)

  const { sx, sy, tx, ty } = (() => {
    const shrunk = shrinkEndpoints(sourceX, sourceY, targetX, targetY, d.sourceGap ?? 0, d.targetGap ?? 0)
    return { sx: shrunk.sx, sy: shrunk.sy, tx: shrunk.tx, ty: shrunk.ty }
  })()

  // sourcePosition/targetPosition are React Flow's own Position enum
  // ('top'|'right'|'bottom'|'left') — the SAME anchor.position FormNode.tsx
  // set on the Handle these endpoints came from (domain/forms.ts's
  // pointAnchor) — converted to wirepath.ts's outward Dir via the one
  // shared conversion (dirFromCardinal) export/geometry-ir.ts also uses.
  // A free end (sourceFree/targetFree — a 'self'-edgeKey empty-form point)
  // overrides that to null regardless of its Position, per the SAME rule
  // ir/geometry-ir.ts's buildLineCmds applies for export parity.
  const sDir = d.sourceFree ? null : dirFromCardinal(sourcePosition)
  const tDir = d.targetFree ? null : dirFromCardinal(targetPosition)
  const { d: edgePath, mid } = wirePath(sx, sy, sDir, tx, ty, tDir, style)
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
