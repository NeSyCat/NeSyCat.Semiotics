'use client'

import { memo } from 'react'
import { Handle, type NodeProps } from '@xyflow/react'
import theme from './theme'
import { geometryFor, type Body } from './forms'
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

// A point's hit area doubles as its connection handle — ~18px so it's easy to
// grab and drag a line from. The glyph renders behind it (pointer-events:none).
// Loose connection mode lets either stacked handle (source/target) start OR
// receive a line, so a point is fully bipolar.
const POINT_HIT = 18

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
      const hid = encodeHandle(edgeKey, index)
      // Handles are 1px AT the glyph centre, so a line anchors dead-centre on the
      // point (RF pins a handle to its position-edge — a large handle offsets the
      // line). The source carries an ~18px transparent grab pad; its pointer
      // events bubble up to the handle, so the point is still easy to grab/drag.
      const dotStyle: React.CSSProperties = {
        position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
        width: 1, height: 1, minWidth: 1, minHeight: 1, background: 'transparent', border: 'none', padding: 0, zIndex: 5,
      }
      pointVisuals.push(
        <span key={`pt-${pid}`}>
          {/* glyph: visual only, behind the handles */}
          <div
            style={{
              position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
              zIndex: 4, pointerEvents: 'none', lineHeight: 0, borderRadius: '50%',
              boxShadow: isSel ? `0 0 0 2px rgba(${accent}, 0.45)` : 'none',
            }}
          >
            <PointGlyph shape={pt.shape} fill={fill} stroke={`rgb(${accent})`} />
          </div>
          <Handle type="target" position={anchor.position} id={hid} style={dotStyle} />
          <Handle
            type="source"
            position={anchor.position}
            id={hid}
            style={dotStyle}
            onClick={(e) => {
              e.stopPropagation()
              if (e.metaKey || e.ctrlKey) toggleSelectedPoint(pid)
              else setSelectedPoints([pid])
            }}
          >
            {/* grab pad — easy to grab; events bubble to the handle above */}
            <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: POINT_HIT, height: POINT_HIT, borderRadius: '50%', cursor: 'crosshair', display: 'block' }} />
          </Handle>
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
