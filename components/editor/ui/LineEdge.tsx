'use client'

import { memo, useMemo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  ViewportPortal,
  getStraightPath,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'
import theme from './theme'
import { useStore } from '../state/store'
import { Tex } from './Tex'
import { toRgbTriple } from '../domain/color'
import type { Color } from '../domain/types'

interface LineEdgeData {
  label: string
  color?: Color
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
  const mode = useStore((s) => s.edgePath)
  const hovered = useStore((s) => s.hoveredEdgeId === id)

  const [edgePath, labelX, labelY] = mode === 'smoothstep'
    ? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
    : getStraightPath({ sourceX, sourceY, targetX, targetY })

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
    </>
  )
}

export default memo(LineEdge)
