'use client'

import { memo } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import theme from './theme'
import { geometryFor, type Anchor, type Body } from './forms'
import { encodeHandle } from './handles'
import { toRgbTriple } from './color'
import { useStore } from './store'
import type { Form, Point, PointShape } from './types'

export interface FormNodeData {
  form: Form
  points: Record<string, Point>
}

// A point's own small glyph. 'dot' is a filled disc; the rest are 12px shapes.
function PointGlyph({ shape, fill, stroke }: { shape: PointShape; fill: string; stroke: string }) {
  if (shape === 'dot') {
    return <div style={{ width: 10, height: 10, borderRadius: '50%', background: fill }} />
  }
  const common = { width: 11, height: 11, display: 'block' } as const
  if (shape === 'circle') {
    return <svg viewBox="0 0 12 12" style={common}><circle cx="6" cy="6" r="5" fill={fill} stroke={stroke} strokeWidth="1" /></svg>
  }
  if (shape === 'square') {
    return <svg viewBox="0 0 12 12" style={common}><rect x="1" y="1" width="10" height="10" fill={fill} stroke={stroke} strokeWidth="1" /></svg>
  }
  return <svg viewBox="0 0 12 12" style={common}><polygon points="6,1 11,11 1,11" fill={fill} stroke={stroke} strokeWidth="1" /></svg>
}

// Bipolar handle: stacked target + source so any point can be a line source or target.
function PointHandle({ id, position, anchor }: { id: string; position: Position; anchor: Anchor }) {
  const handleStyle: React.CSSProperties = {
    position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
    width: 1, height: 1, minWidth: 1, minHeight: 1,
    background: 'transparent', border: 'none', padding: 0, cursor: 'crosshair', zIndex: 3,
  }
  return (
    <>
      <Handle type="target" position={position} id={id} style={handleStyle} />
      <Handle type="source" position={position} id={id} style={handleStyle} />
    </>
  )
}

// Body fill + 1.5px border. Selection only brightens the fill/border — no glow.
function BodyView({ body, n, accent, selected, bodyOpacity }: {
  body: Body; n: number; accent: string; selected: boolean; bodyOpacity: number
}) {
  const fillOpacity = (selected ? theme.node.selectedFillOpacity : theme.node.fillOpacity) * bodyOpacity
  const borderOpacity = (selected ? theme.node.selectedBorderOpacity : theme.node.borderOpacity) * bodyOpacity
  const bg = `rgba(${accent}, ${fillOpacity})`
  const border = `rgba(${accent}, ${borderOpacity})`

  if (body.type === 'circle') {
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: bg, outline: `1.5px solid ${border}`, outlineOffset: -0.75,
        transition: 'background 0.15s ease, outline-color 0.15s ease',
      }} />
    )
  }
  const pts = body.pointsFrac
  const clip = `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(', ')})`
  const polyPts = pts.map(([x, y]) => `${x * n},${y * n}`).join(' ')
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, clipPath: clip, background: bg, transition: 'background 0.15s ease' }} />
      <svg width={n} height={n} style={{ position: 'absolute', inset: 0, overflow: 'visible' }}>
        <polygon points={polyPts} fill="none" stroke={border} strokeWidth={1.5} />
      </svg>
    </>
  )
}

function FormNode({ data, selected }: NodeProps) {
  const { form, points } = data as unknown as FormNodeData
  const geom = geometryFor(form.kind)
  const n = geom.nodeSize(form)
  const accent = toRgbTriple(form.color)

  const selectedPoints = useStore((s) => s.selectedPoints)
  const setSelectedPoints = useStore((s) => s.setSelectedPoints)
  const toggleSelectedPoint = useStore((s) => s.toggleSelectedPoint)

  const pointVisuals: React.ReactNode[] = []
  for (const edgeKey of geom.edgeKeys) {
    const ids = form.edges[edgeKey] ?? []
    ids.forEach((pid, index) => {
      const pt = points[pid]
      if (!pt) return
      const anchor = geom.pointAnchor(edgeKey, index, ids.length, n)
      const isSel = selectedPoints.includes(pid)
      const fill = isSel ? `rgb(${accent})` : `rgba(${accent}, 0.85)`
      pointVisuals.push(
        <span key={`pt-${pid}`}>
          <div
            onClick={(e) => {
              e.stopPropagation()
              if (e.metaKey || e.ctrlKey) toggleSelectedPoint(pid)
              else setSelectedPoints([pid])
            }}
            style={{
              position: 'absolute', top: anchor.y, left: anchor.x,
              transform: 'translate(-50%, -50%)', zIndex: 4,
            }}
          >
            <PointGlyph shape={pt.shape} fill={fill} stroke={`rgb(${accent})`} />
          </div>
          <PointHandle id={encodeHandle(edgeKey, index)} position={anchor.position} anchor={anchor} />
        </span>,
      )
    })
  }

  return (
    <div style={{ position: 'relative', width: n, height: n, cursor: 'pointer' }}>
      <BodyView body={geom.body} n={n} accent={accent} selected={!!selected} bodyOpacity={geom.bodyOpacity} />
      {pointVisuals}
    </div>
  )
}

export default memo(FormNode)
