'use client'

import { memo, useEffect, useRef } from 'react'
import { Handle, Position, useConnection, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import theme from './theme'
import { geometryFor, pointIdsAt, insertionIndex, shrunkBodyPoints, CENTER_SHRINK, type Body, type RegionShape } from './forms'
import { encodeHandle, encodePhantomHandle, decodePhantomHandle } from './handles'
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

// Quiver-style point-creation region overlay: a gray-tint stripe along an
// edge, a dot at a corner, or the whole body for point/empty's single
// self-region. The corner-dot size doubles as a point's grab-pad size so a
// point's draggable area coincides exactly with its visual hover circle.
const REGION_STRIPE_WIDTH = 26
const REGION_CORNER_SIZE = 28

// The visual hover tint for a point-creation region — an INDICATOR of which
// edge/corner the cursor's zone maps to. Purely decorative; the grabbable
// area is RingBandHitArea below, which covers the zone itself.
function RegionOverlay({ shape, n, color }: { shape: RegionShape; n: number; color: string }) {
  if (shape.kind === 'full') {
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: color,
        pointerEvents: 'none', zIndex: 1,
      }} />
    )
  }
  if (shape.kind === 'corner') {
    const [x, y] = shape.at
    return (
      <div style={{
        position: 'absolute', left: x * n, top: y * n, transform: 'translate(-50%, -50%)',
        width: REGION_CORNER_SIZE, height: REGION_CORNER_SIZE, borderRadius: '50%', background: color,
        pointerEvents: 'none', zIndex: 1,
      }} />
    )
  }
  const pts = shape.points.map(([x, y]) => `${x * n},${y * n}`).join(' ')
  return (
    <svg width={n} height={n} style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 1 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth={REGION_STRIPE_WIDTH} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// An outline of `body` scaled by `scale` about the form's centre, as SVG
// path commands in the phantom handle's anchor-relative frame. Circle bodies
// get a real circle path; polygons reuse pointsFrac. Both derive from the
// SAME body data isInsideBody/isInCenterZone hit-test against.
function bodyOutlinePath(body: Body, n: number, scale: number, anchor: { x: number; y: number }): string {
  const c = n / 2
  if (body.type === 'circle' || body.type === 'dot') {
    const r = c * scale
    const x0 = c - r - anchor.x
    const cy = c - anchor.y
    return `M ${x0} ${cy} a ${r} ${r} 0 1 0 ${2 * r} 0 a ${r} ${r} 0 1 0 ${-2 * r} 0 Z`
  }
  const pts = body.pointsFrac.map(([x, y]) => [c + (x * n - c) * scale - anchor.x, c + (y * n - c) * scale - anchor.y])
  return `M ${pts.map(([x, y]) => `${x} ${y}`).join(' L ')} Z`
}

// The phantom handle's grabbable/droppable area: the ENTIRE point-creation
// zone — the band between the body's boundary and the center zone (or the
// whole body for kinds without one). Built from the SAME body + CENTER_SHRINK
// the hover hit-test (isInsideBody && !isInCenterZone) uses, so the crosshair
// is active exactly wherever edge-hover is active — not merely on the visual
// indicator stripe. Even-odd fill carves the center zone out as a hole.
// Lives as a CHILD of the tiny anchored Handle (a Handle sized to the whole
// form makes React Flow draw connection lines from the form's middle), hence
// the anchor-relative frame.
function RingBandHitArea({ body, n, hasCenterZone, anchor }: {
  body: Body; n: number; hasCenterZone: boolean; anchor: { x: number; y: number }
}) {
  const outer = bodyOutlinePath(body, n, 1, anchor)
  const inner = hasCenterZone ? ' ' + bodyOutlinePath(body, n, CENTER_SHRINK, anchor) : ''
  return (
    // pointerEvents:none on the SVG wrapper; only the painted band itself
    // (fill, minus the even-odd hole) is interactive — an unpainted SVG box
    // would otherwise win hit-tests against siblings.
    <svg width={1} height={1} style={{ position: 'absolute', left: 0, top: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 1 }}>
      <path d={outer + inner} fill="transparent" fillRule="evenodd" stroke="none" pointerEvents="fill" style={{ cursor: 'crosshair' }} />
    </svg>
  )
}

// Hovering the center zone (a smaller inner region — see isInCenterZone)
// highlights the WHOLE form body, edge to edge — same outline BodyView
// itself draws, just tinted for hover instead of selection.
function CenterOverlay({ body, n, color }: { body: Body; n: number; color: string }) {
  if (body.type !== 'polygon') {
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: color,
        pointerEvents: 'none', zIndex: 1,
      }} />
    )
  }
  const clip = `polygon(${body.pointsFrac.map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(', ')})`
  return <div style={{ position: 'absolute', inset: 0, clipPath: clip, background: color, pointerEvents: 'none', zIndex: 1 }} />
}

// The CSS class React Flow's dragHandle prop targets (set on the node in
// Canvas.tsx) — restricts native node-dragging to exactly the center zone.
// Trying to prevent dragging by intercepting the pointerdown event ourselves
// loses the race against React Flow's own internal (earlier-attached)
// listener; dragHandle is the library's own first-class way to scope it.
export const DRAG_HANDLE_CLASS = 'form-drag-handle'

// Always-present (unlike CenterOverlay, which only renders on hover) — an
// invisible hit-area shaped like the shrunk center zone, matching
// isInCenterZone's own boundary exactly so dragging is enabled EXACTLY
// where center-hover/selection are.
function DragHandleZone({ body, n }: { body: Body; n: number }) {
  const shrunk = shrunkBodyPoints(body)
  if (shrunk) {
    const clip = `polygon(${shrunk.map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(', ')})`
    return <div className={DRAG_HANDLE_CLASS} style={{ position: 'absolute', inset: 0, clipPath: clip, zIndex: 2 }} />
  }
  // circle/dot body: shrunkBodyPoints only handles 'polygon' — same
  // CENTER_SHRINK factor, just expressed as a smaller inscribed circle
  // instead of a scaled point list.
  const d = n * CENTER_SHRINK
  return (
    <div className={DRAG_HANDLE_CLASS} style={{
      position: 'absolute', left: n / 2, top: n / 2, transform: 'translate(-50%, -50%)',
      width: d, height: d, borderRadius: '50%', zIndex: 2,
    }} />
  )
}

// Body fill + 1.5px border. No colour → transparent fill; the border is ALWAYS
// pure black. Selection only tints the fill.
function BodyView({ body, n, accent, selected, bodyOpacity, hasCenterZone }: {
  body: Body; n: number; accent: string | null; selected: boolean; bodyOpacity: number; hasCenterZone: boolean
}) {
  const fillOpacity = (selected ? theme.node.selectedFillOpacity : theme.node.fillOpacity) * bodyOpacity
  const bg = accent
    ? `rgba(${accent}, ${fillOpacity})`
    : (selected ? theme.node.regionSelected : 'transparent')
  const border = `rgba(0, 0, 0, ${bodyOpacity})` // pure black (transparent only for the empty form)
  // Purely decorative — this was silently winning hit-tests against the
  // DragHandleZone/phantom-handle overlays near the body's own boundary
  // (an SVG stroke's hit region is wider than its visual width), breaking
  // ring dragging right where it mattered most. Only kinds WITH a center
  // zone have that always-present DragHandleZone as a fallback interactive
  // catch-all — point/empty have none, so their body must stay clickable or
  // basic select/drag breaks for them entirely.
  const decorative = hasCenterZone ? ({ pointerEvents: 'none' } as const) : {}

  if (body.type === 'circle') {
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%',
        background: bg, outline: `1.5px solid ${border}`, outlineOffset: -0.75,
        transition: 'background 0.15s ease, outline-color 0.15s ease',
        ...decorative,
      }} />
    )
  }
  if (body.type === 'dot') {
    const fill = accent ? `rgb(${accent})` : theme.text.ink
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: fill,
        boxShadow: selected ? `0 0 0 3px ${theme.node.regionSelected}` : 'none',
        transition: 'background 0.15s ease, box-shadow 0.15s ease',
        ...decorative,
      }} />
    )
  }
  const pts = body.pointsFrac
  const clip = `polygon(${pts.map(([x, y]) => `${(x * 100).toFixed(3)}% ${(y * 100).toFixed(3)}%`).join(', ')})`
  const polyPts = pts.map(([x, y]) => `${x * n},${y * n}`).join(' ')
  return (
    <>
      <div style={{ position: 'absolute', inset: 0, clipPath: clip, background: bg, transition: 'background 0.15s ease', ...decorative }} />
      <svg width={n} height={n} style={{ position: 'absolute', inset: 0, overflow: 'visible', ...decorative }}>
        <polygon points={polyPts} fill="none" stroke={border} strokeWidth={1.5} />
      </svg>
    </>
  )
}

function FormNode({ id, data, selected }: NodeProps) {
  const { form, points } = data as unknown as FormNodeData
  const geom = geometryFor(form.kind)
  // Scale is a size multiplier applied right here — every zone/anchor/handle
  // below derives from n, so they all scale automatically along with it.
  const n = geom.nodeSize(form) * (form.scale ?? 1)
  const centroid = bodyCentroid(geom.body)
  const accent = form.color ? toRgbTriple(form.color) : null

  // Rotation is a CSS transform on the whole node (body + points + name, one
  // rigid unit). Handles move with it, but React Flow only remeasures handle
  // positions on resize — a pure transform doesn't trigger that — so nudge it
  // explicitly or connected edges keep drawing to the pre-rotation spot. Scale
  // changes the node's actual box size, which needs the same nudge.
  const updateNodeInternals = useUpdateNodeInternals()
  useEffect(() => { updateNodeInternals(id) }, [id, form.rotation, form.scale, updateNodeInternals])

  const selectedPoints = useStore((s) => s.selectedPoints)
  const setSelectedPoints = useStore((s) => s.setSelectedPoints)
  const toggleSelectedPoint = useStore((s) => s.toggleSelectedPoint)
  // Cursor territory is resolved centrally in Canvas.tsx (point proximity >
  // center zone > edge/corner ring); each derived value below is scoped so a
  // hover change elsewhere doesn't re-render every FormNode/point — only the
  // one thing that actually changed.
  const hover = useStore((s) => s.hover)
  const hoverEdgeKey = hover?.kind === 'edge' && hover.formId === id ? hover.edgeKey : null
  // The exact gesture position within that edge — drives the phantom
  // handle's rendered slot below, so it sits under the cursor instead of a
  // fixed "always append" spot.
  const hoverRx = hover?.kind === 'edge' && hover.formId === id ? hover.rx : null
  const hoverRy = hover?.kind === 'edge' && hover.formId === id ? hover.ry : null
  const hoverCenter = hover?.kind === 'center' && hover.formId === id
  const { setNodes } = useReactFlow()

  // The phantom handle (below) must stay mounted for the WHOLE lifetime of a
  // connection drag that started from it — hover clears the instant the
  // cursor leaves this form on its way to the drop target, which would
  // otherwise unmount the very Handle React Flow is mid-drag from. Falling
  // back to the in-progress connection's own fromHandle (decoded) keeps it
  // rendered, at its original edge, for exactly as long as the drag lasts.
  const activeConnectionFromHandle = useConnection((c) =>
    c.inProgress && c.fromNode?.id === id ? (c.fromHandle?.id ?? null) : null,
  )
  const phantomEdgeKey = hoverEdgeKey ?? (activeConnectionFromHandle ? decodePhantomHandle(activeConnectionFromHandle) : null)
  // The phantom's rendered slot (see below) — frozen here the moment the
  // cursor last reported a live gesture position on this edge, so that once
  // hover clears mid-drag (the cursor has moved on toward the drop target)
  // the origin stays exactly where the user grabbed instead of jumping to
  // the old fixed "always append" position. Resets when the edge itself
  // changes so a stale slot from a DIFFERENT edge is never reused.
  const lastPhantomSlotRef = useRef<number | null>(null)
  useEffect(() => { lastPhantomSlotRef.current = null }, [phantomEdgeKey])
  // The phantom Handle mounts/unmounts/moves on every hover change — React
  // Flow only re-measures handle bounds via a ResizeObserver on the node's
  // overall box, which a child appearing/disappearing doesn't trigger (the
  // node's own n×n size never changes), so a just-mounted phantom is
  // invisible to React Flow's own connection-start hit-testing until this
  // nudges it to re-scan. Same fix rotation already needed above.
  useEffect(() => { updateNodeInternals(id) }, [id, phantomEdgeKey, updateNodeInternals])

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
      // A point's own color wins over the form's accent (the inherited tint).
      const glyphTriple = pt.color ? toRgbTriple(pt.color) : accent
      const fill = glyphTriple ? (isSel ? `rgb(${glyphTriple})` : `rgba(${glyphTriple}, 0.85)`) : theme.text.ink
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
      // A point's own drag-region hover always wins over the form's
      // region/center hover (decided centrally in Canvas.tsx's
      // nearestPointWithin) — a selected point gets the darker tint instead,
      // quiver's hover/select language, not the blue form-selection accent.
      const isHovered = hover?.kind === 'point' && hover.pointId === pid
      const regionTint = isSel ? theme.node.regionSelected : isHovered ? theme.node.regionHover : null
      pointVisuals.push(
        <span key={`pt-${pid}`}>
          {/* drag-region tint — a consistent circle for ALL points (incl. empty) */}
          {regionTint && (
            <div style={{
              position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
              width: REGION_CORNER_SIZE, height: REGION_CORNER_SIZE, borderRadius: '50%', zIndex: 3, pointerEvents: 'none',
              background: regionTint,
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
            <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: REGION_CORNER_SIZE, height: REGION_CORNER_SIZE, borderRadius: '50%', cursor: 'crosshair', display: 'block' }} />
          </Handle>
          {/* point name — click it to select the point too; hidden via .points-hidden
              (see globals.css) when the Points toggle is off. data-point-id lets
              Canvas.tsx's onNodeMouseMove recognize a real hover here directly
              from the DOM event target — the label's rendered width varies with
              the name text, so a fixed proximity radius around the anchor alone
              can't reliably reach it. */}
          {/* Canvas-coloured mask so wires don't strike through the name — same
              idea as the line label's mask (LineEdge.tsx). A SEPARATE inert
              sibling at zIndex 0: above the edges layer (masks the wire) but
              below every tint overlay (zIndex 1+), so form hover/selection
              states sweep straight across the name instead of being notched.
              It positions/sizes itself with a hidden copy of the label text;
              the actual fill is an INSET band, tighter than KaTeX's tall line
              box, so the mask doesn't blank the wire farther out than the
              glyphs themselves. */}
          <div
            className="point-label"
            aria-hidden="true"
            style={{ position: 'absolute', ...lblPos, zIndex: 0, pointerEvents: 'none' }}
          >
            <span style={{ visibility: 'hidden' }}>
              <Tex fontSize={POINT_NAME_SIZE} color={theme.text.ink}>{pt.name ?? pid}</Tex>
            </span>
            <span style={{
              position: 'absolute', left: -2, right: -2, top: '15%', bottom: '15%',
              background: theme.canvas.background, borderRadius: 5,
            }} />
          </div>
          <div
            className="point-label"
            data-point-id={pid}
            onClick={(e) => selectPoint(e, pid)}
            style={{ position: 'absolute', ...lblPos, zIndex: 4, cursor: 'pointer' }}
          >
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
      <BodyView body={geom.body} n={n} accent={accent} selected={!!selected} bodyOpacity={geom.bodyOpacity} hasCenterZone={geom.hasCenterZone} />
      {/* dragHandle hit-area (see Canvas.tsx's node-building) — kinds with no
          center zone (point/empty) stay draggable from anywhere, matching
          their existing "whole body is one region" behavior. */}
      {geom.hasCenterZone && <DragHandleZone body={geom.body} n={n} />}
      {/* point-creation region hover — quiver-style: shows which edge/corner a
          double-click would land a new point on */}
      {hoverEdgeKey && <RegionOverlay shape={geom.regionShape(hoverEdgeKey)} n={n} color={theme.node.regionHover} />}
      {/* Phantom handle — kept TINY and anchored exactly like a real point's
          dotStyle (a Handle sized to the whole form makes React Flow draw
          the connection line from the form's middle instead of the edge —
          confirmed the hard way). Its grabbable/droppable area is a CHILD
          RingBandHitArea covering the ENTIRE point-creation zone (the band
          the hover hit-test fires in), so the crosshair works wherever the
          hover is active — the tint stripe is only the indicator of which
          edge that zone maps to. As the cursor crosses into a different
          edge's territory, hover updates and this phantom re-anchors there,
          so a press ALWAYS starts from the currently-indicated edge.
          Pulling a line out of the band goes through React Flow's own
          native connection-drag (same as dragging from a real point); the
          phantom id resolves into a real point (addPoint) in Canvas.tsx's
          onConnect(End) the moment a connection actually completes. */}
      {phantomEdgeKey && (() => {
        const count = pointIdsAt(form, phantomEdgeKey).length
        // Track the live gesture: while hover is actually reporting a
        // position on THIS edge, the slot is wherever a new point would be
        // inserted right now (forms.ts's insertionIndex — the same math
        // addPoint's call sites use); once hover clears mid-drag, hold the
        // last live slot instead of reverting to a fixed "always append"
        // position, so the origin doesn't jump away from where the user grabbed.
        const slot = hoverEdgeKey === phantomEdgeKey && hoverRx != null && hoverRy != null
          ? (lastPhantomSlotRef.current = insertionIndex(form, phantomEdgeKey, hoverRx, hoverRy))
          : (lastPhantomSlotRef.current ?? count)
        const anchor = geom.pointAnchor(phantomEdgeKey, slot, count + 1, n)
        const hid = encodePhantomHandle(phantomEdgeKey)
        const dotStyle: React.CSSProperties = {
          position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
          width: 1, height: 1, minWidth: 1, minHeight: 1, background: 'transparent', border: 'none', padding: 0, zIndex: 5,
        }
        return (
          <span key="phantom">
            <Handle type="target" position={anchor.position} id={hid} style={dotStyle}>
              <RingBandHitArea body={geom.body} n={n} hasCenterZone={geom.hasCenterZone} anchor={anchor} />
            </Handle>
            <Handle type="source" position={anchor.position} id={hid} style={dotStyle}>
              <RingBandHitArea body={geom.body} n={n} hasCenterZone={geom.hasCenterZone} anchor={anchor} />
            </Handle>
          </span>
        )
      })()}
      {/* center hover — shows that a plain click here selects the whole form */}
      {hoverCenter && <CenterOverlay body={geom.body} n={n} color={theme.node.regionHover} />}
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
