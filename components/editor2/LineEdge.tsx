'use client'

import { memo, useMemo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'
import theme from './theme'
import { useStore } from './store'
import { Tex } from './Tex'
import { toRgbTriple } from './color'
import type { Color } from './types'

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

  const [edgePath, labelX, labelY] = mode === 'smoothstep'
    ? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
    : getStraightPath({ sourceX, sourceY, targetX, targetY })

  const lineColor = d.color ? `rgb(${toRgbTriple(d.color)})` : '#000000' // no colour → black
  const edgeStyle = useMemo(
    () => ({
      stroke: selected ? `rgb(${theme.node.accentBlue})` : lineColor, // blue when selected
      strokeWidth: selected ? 2.5 : 1.5,
      transition: 'stroke 0.15s ease, stroke-width 0.15s ease',
    }),
    [selected, lineColor],
  )

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={edgeStyle} />
      <EdgeLabelRenderer>
        {/* Read-only LaTeX label (edited only in the Name field). No box — just a
            small canvas-coloured mask so the line doesn't strike through it. */}
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
