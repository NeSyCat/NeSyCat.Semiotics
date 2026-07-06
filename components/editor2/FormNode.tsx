'use client'

import { memo, useEffect } from 'react'
import { Handle, Position, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import theme from './theme'
import { geometryFor, pointIdsAt, type Body } from './forms'
import { encodeHandle } from './handles'
import { toRgbTriple } from './color'
import { useStore } from './store'
import { Tex } from './Tex'
import type { Form, Point, PointShape } from './types'

export interface FormNodeData {
  form: Form
  points: Record<string, Point>
}

const POINT_GLYPH = 15
const FORM_NAME_SIZE = 16 // forms and lines share this size
const POINT_NAME_SIZE = 12 // points a little smaller

// Visual centre of a form body — for centring its name label. A triangle's
// centroid is not its bounding-box centre.
function bodyCentroid(body: Body): [number, number] {
  if (body.type === 'circle' || body.type === 'dot') return [0.5, 0.5]
  const pts = body.pointsFrac
  let sx = 0, sy = 0
  for (const [x, y] of pts) { sx += x; sy += y }
  return [sx / pts.length, sy / pts.length]
}
// A point's glyph is drawn from the SAME sprite as the toolbar (see Canvas's
// ToolbarSprite), rendered small and filled in the point's colour — so a point
// shares the form/Shape-rail shape vocabulary. 'square' uses kind-rectangle.
function PointGlyph({ shape, color }: { shape: PointShape; color: string }) {
  if (shape === 'empty') return null // Empty = nothing rendered; the dashed circle is only the toolbar symbol
  const sym = shape === 'square' ? 'kind-rectangle' : `kind-${shape}`
  return (
    <svg
      width={POINT_GLYPH}
      height={POINT_GLYPH}
      viewBox="0 0 24 24"
      style={{ display: 'block', color, fill: color, stroke: color, strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round' }}
    >
      <use href={`#${sym}`} />
    </svg>
  )
}

// A point's hit area doubles as its connection handle — ~18px so it's easy to
// grab and drag a line from. The glyph renders behind it (pointer-events:none).
// Loose connection mode lets either stacked handle (source/target) start OR
// receive a line, so a point is fully bipolar.
const POINT_HIT = 18

// Body fill + 1.5px border. No colour → transparent fill; the border is ALWAYS
// pure black. Selection only tints the fill.
function BodyView({ body, n, accent, selected, bodyOpacity }: {
  body: Body; n: number; accent: string | null; selected: boolean; bodyOpacity: number
}) {
  const fillOpacity = (selected ? theme.node.selectedFillOpacity : theme.node.fillOpacity) * bodyOpacity
  const bg = accent
    ? `rgba(${accent}, ${fillOpacity})`
    : (selected ? `rgba(${theme.node.accentBlue}, ${0.10 * bodyOpacity})` : 'transparent')
  const border = `rgba(0, 0, 0, ${bodyOpacity})` // pure black (transparent only for the empty form)

  if (body.type === 'circle') {
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: bg, outline: `1.5px solid ${border}`, outlineOffset: -0.75,
        transition: 'background 0.15s ease, outline-color 0.15s ease',
      }} />
    )
  }
  if (body.type === 'dot') {
    const fill = accent ? `rgb(${accent})` : theme.text.ink
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: fill,
        boxShadow: selected ? `0 0 0 3px rgba(${theme.node.accentBlue}, 0.45)` : 'none',
        transition: 'background 0.15s ease, box-shadow 0.15s ease',
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

function FormNode({ id, data, selected }: NodeProps) {
  const { form, points } = data as unknown as FormNodeData
  const geom = geometryFor(form.kind)
  const n = geom.nodeSize(form)
  const centroid = bodyCentroid(geom.body)
  const accent = form.color ? toRgbTriple(form.color) : null

  // Rotation is a CSS transform on the whole node (body + points + name, one
  // rigid unit). Handles move with it, but React Flow only remeasures handle
  // positions on resize — a pure transform doesn't trigger that — so nudge it
  // explicitly or connected edges keep drawing to the pre-rotation spot.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [id, form.rotation, updateNodeInternals])

  const selectedPoints = useStore((s) => s.selectedPoints)
  const setSelectedPoints = useStore((s) => s.setSelectedPoints)
  const toggleSelectedPoint = useStore((s) => s.toggleSelectedPoint)
  const { setNodes } = useReactFlow()

  // Select a point (from its glyph/grab handle OR its name): exclusive with form
  // selection; Cmd/Ctrl+click accumulates, plain click single-selects.
  const selectPoint = (e: React.MouseEvent, pid: string) => {
    e.stopPropagation()
    setNodes((nds) => (nds.some((nd) => nd.selected) ? nds.map((nd) => (nd.selected ? { ...nd, selected: false } : nd)) : nds))
    if (e.metaKey || e.ctrlKey) toggleSelectedPoint(pid)
    else setSelectedPoints([pid])
  }

  const pointVisuals: React.ReactNode[] = []
  for (const edgeKey of geom.edgeKeys) {
    const ids = pointIdsAt(form, edgeKey)
    ids.forEach((pid, index) => {
      const pt = points[pid]
      if (!pt) return
      const anchor = geom.pointAnchor(edgeKey, index, ids.length, n)
      const isSel = selectedPoints.includes(pid)
      const fill = accent ? (isSel ? `rgb(${accent})` : `rgba(${accent}, 0.85)`) : theme.text.ink
      const hid = encodeHandle(edgeKey, index)
      // The name label sits OUTSIDE the point, in its edge's outward direction
      // (apex point → right, left-edge point → left, etc.). Counter-rotate so
      // it stays upright/readable when the form is rotated — same billboard
      // trick as the form's own name label.
      const GAP = 11
      const counterRotate = ` rotate(${-(form.rotation ?? 0)}deg)`
      const lblPos: React.CSSProperties =
        anchor.position === Position.Left ? { left: anchor.x - GAP, top: anchor.y, transform: `translate(-100%, -50%)${counterRotate}` }
          : anchor.position === Position.Right ? { left: anchor.x + GAP, top: anchor.y, transform: `translate(0, -50%)${counterRotate}` }
            : anchor.position === Position.Top ? { left: anchor.x, top: anchor.y - GAP, transform: `translate(-50%, -100%)${counterRotate}` }
              : { left: anchor.x, top: anchor.y + GAP, transform: `translate(-50%, 0)${counterRotate}` }
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
          {/* selection ring — a consistent circle for ALL points (incl. empty) */}
          {isSel && (
            <div style={{
              position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
              width: 15, height: 15, borderRadius: '50%', zIndex: 3, pointerEvents: 'none',
              boxShadow: `0 0 0 2px rgba(${theme.node.accentBlue}, 0.45)`,
            }} />
          )}
          {/* glyph: visual only, behind the handles */}
          <div style={{
            position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
            zIndex: 4, pointerEvents: 'none', lineHeight: 0,
          }}>
            <PointGlyph shape={pt.shape} color={fill} />
          </div>
          <Handle type="target" position={anchor.position} id={hid} style={dotStyle} />
          <Handle type="source" position={anchor.position} id={hid} style={dotStyle} onClick={(e) => selectPoint(e, pid)}>
            {/* grab pad — easy to grab; events bubble to the handle above */}
            <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: POINT_HIT, height: POINT_HIT, borderRadius: '50%', cursor: 'crosshair', display: 'block' }} />
          </Handle>
          {/* point name — click it to select the point too; hidden via .points-hidden
              (see globals.css) when the Points toggle is off */}
          <div className="point-label" onClick={(e) => selectPoint(e, pid)} style={{ position: 'absolute', ...lblPos, zIndex: 4, cursor: 'pointer' }}>
            <Tex fontSize={POINT_NAME_SIZE} color={theme.text.ink}>{pt.name ?? pid}</Tex>
          </div>
        </span>,
      )
    })
  }

  return (
    <div style={{
      position: 'relative', width: n, height: n, cursor: 'pointer',
      transform: form.rotation ? `rotate(${form.rotation}deg)` : undefined,
    }}>
      <BodyView body={geom.body} n={n} accent={accent} selected={!!selected} bodyOpacity={geom.bodyOpacity} />
      {geom.bodyOpacity > 0 && geom.showName && (
        <div style={{
          position: 'absolute', left: centroid[0] * n, top: centroid[1] * n,
          // Counter-rotate so the name stays upright/readable — it's along
          // for the ride positionally, but its own orientation shouldn't spin.
          transform: `translate(-50%, -50%) rotate(${-(form.rotation ?? 0)}deg)`,
          pointerEvents: 'none', zIndex: 3,
        }}>
          <Tex fontSize={FORM_NAME_SIZE} color={theme.text.ink}>{form.name ?? form.id}</Tex>
        </div>
      )}
      {pointVisuals}
    </div>
  )
}

export default memo(FormNode)
