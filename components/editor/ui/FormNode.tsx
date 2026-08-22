'use client'

import { memo, useEffect, useRef } from 'react'
import { Handle, useConnection, useReactFlow, useUpdateNodeInternals, type NodeProps } from '@xyflow/react'
import theme from './theme'
import { geometryFor, pointIdsAt, insertionIndex, shrunkBodyPoints, bodyCentroid, CENTER_SHRINK, POINT_SIZE, type Body, type FormGeometry, type RegionShape } from '../domain/forms'
import { encodeHandle, encodePhantomHandle, decodePhantomHandle } from '../domain/handles'
import { toRgbTriple } from '../domain/color'
import { useStore } from '../state/store'
import { Tex } from './Tex'
import { PointVisual } from './PointVisual'
import { ShapeBody, tintFill, type GapPoint } from './ShapeBody'
import type { EdgeKey, Form, Point } from '../domain/types'

export interface FormNodeData {
  form: Form
  points: Record<string, Point>
}

const FORM_NAME_SIZE = 16 // forms and lines share this size

// Quiver-style point-creation region overlay: a gray-tint stripe along an
// edge, or the whole body for 'empty's single self-region. (PointVisual's own
// REGION_CORNER_SIZE doubles as a point's grab-pad size so a point's
// draggable area coincides exactly with its visual hover circle — it's not
// corner-only, despite the name.) The stripe's breadth IS POINT_SIZE — see
// its own comment in domain/forms.ts — so a glyph sitting on this stripe
// fits flush inside it, outer edge to outer edge, instead of overflowing.
const REGION_STRIPE_WIDTH = POINT_SIZE

// Extra along-edge nudge for a point's label when it shares its edge with
// other points — matches ir/geometry-ir.ts's own SPLAY_PX (kept in sync by
// hand, same pattern as PointVisual.tsx's GAP/LABEL_GAP_PX pair).
const SPLAY_PX = 40

// Fix for "two named points on the same edge collide" (e.g. a discriminated
// -union triangle's base with 'Article'/'Tutorial'): when a point shares its
// edge with siblings, nudge its label an EXTRA fixed distance along the
// edge's own tangent direction — sign flips by whether this point sits
// before or after its siblings' midpoint index, so adjacent labels grow
// APART instead of stacking on top of each other. A lone point, or the
// exact centre point of an odd-count edge, gets zero bias (unchanged).
//
// MIRRORS ir/geometry-ir.ts's edgeLabelSplayLocal EXACTLY (same tangent-
// from-first/last-sibling-anchor math, same sign-by-index-vs-midpoint rule)
// so canvas and exports agree pixel-for-pixel — see that function's own
// comment for the full rationale (why a roughly-horizontal rotated edge
// ends up splaying in screen-X, an unrotated vertical edge in screen-Y).
function edgeLabelSplay(geom: FormGeometry, edgeKey: EdgeKey, index: number, count: number, n: number): { x: number; y: number } {
  if (count <= 1) return { x: 0, y: 0 }
  const mid = (count - 1) / 2
  const sign = Math.sign(index - mid)
  if (sign === 0) return { x: 0, y: 0 } // exact centre of an odd-count edge
  const start = geom.pointAnchor(edgeKey, 0, count, n)
  const end = geom.pointAnchor(edgeKey, count - 1, count, n)
  const tx = end.x - start.x
  const ty = end.y - start.y
  const len = Math.hypot(tx, ty)
  if (len < 1e-6) return { x: 0, y: 0 } // degenerate edge — no meaningful tangent, no bias
  return { x: (sign * SPLAY_PX * tx) / len, y: (sign * SPLAY_PX * ty) / len }
}

// The visual hover tint for a point-creation region — an INDICATOR of which
// edge the cursor's zone maps to. Purely decorative; the grabbable area is
// RingBandHitArea below, which covers the zone itself.
function RegionOverlay({ shape, n, color }: { shape: RegionShape; n: number; color: string }) {
  if (shape.kind === 'full') {
    return (
      <div style={{
        position: 'absolute', inset: 0, borderRadius: '50%', background: color,
        pointerEvents: 'none', zIndex: 1,
      }} />
    )
  }
  if (shape.kind === 'spot') {
    const [x, y] = shape.at
    return (
      <div style={{
        position: 'absolute', left: x * n, top: y * n, transform: 'translate(-50%, -50%)',
        width: POINT_SIZE, height: POINT_SIZE, borderRadius: '50%', background: color,
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
  if (body.type === 'circle') {
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
  // circle body: shrunkBodyPoints only handles 'polygon' — same
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

// The radius (px, node-space) a resident point's glyph occupies — POINT_SIZE
// is the glyph's rendered DIAMETER (domain/forms.ts); the body border/fill
// gaps around each resident point by exactly this much, so the border never
// draws underneath a point's own (separately-rendered, possibly-transparent)
// glyph outline.
const BODY_GAP_R = POINT_SIZE / 2

// A form's own body — a thin ShapeBody wrapper (ui/ShapeBody.tsx; the SAME
// shared border/fill/geometry rendering PointVisual's glyph uses) plus the
// two form-only concerns ShapeBody doesn't know about: the fill's OWN
// opacity-scale/border-alpha follow bodyOpacity (0 makes 'empty' invisible),
// and DragHandleZone's hit-test needs the body to stay click-through
// wherever that always-present fallback exists (`decorative`).
function BodyView({ body, n, accent, selected, bodyOpacity, hasCenterZone, gapPoints, maskId }: {
  body: Body; n: number; accent: string | null; selected: boolean; bodyOpacity: number; hasCenterZone: boolean
  // gapBody: the gapped point's OWN shape geometry (see GapPoint's comment,
  // ShapeBody.tsx) — a polygon-bodied point punches a matching polygon hole
  // instead of an oversized circle.
  gapPoints: ReadonlyArray<{ x: number; y: number; gapBody: Body }>; maskId: string
}) {
  const fill = tintFill(accent, selected, bodyOpacity)
  // Purely decorative — this was silently winning hit-tests against the
  // DragHandleZone/phantom-handle overlays near the body's own boundary
  // (an SVG stroke's hit region is wider than its visual width), breaking
  // ring dragging right where it mattered most. Only kinds WITH a center
  // zone have that always-present DragHandleZone as a fallback interactive
  // catch-all — 'empty' has none, so its body must stay clickable or basic
  // select/drag breaks for it entirely.
  const decorative = hasCenterZone ? ({ pointerEvents: 'none' } as const) : {}
  const gaps: GapPoint[] = gapPoints.map((p) => ({ x: p.x, y: p.y, r: BODY_GAP_R, body: p.gapBody }))
  return <ShapeBody body={body} n={n} fill={fill} borderOpacity={bodyOpacity} gapPoints={gaps} maskId={maskId} style={decorative} />
}

function FormNode({ id, data, selected }: NodeProps) {
  const { form, points } = data as unknown as FormNodeData
  const geom = geometryFor(form.shape)
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
  // one thing that actually changed. The selector filters out OTHER nodes'
  // edge/center hovers: edge hovers now update on every cursor move within
  // the edge (rx/ry drive the phantom slot), so an unnarrowed subscription
  // would re-render every FormNode per mousemove — this keeps that cost on
  // the one hovered node. Point hovers pass through for every node (they're
  // deduped per-pointId in setHover, so they only fire on target change).
  const hover = useStore((s) =>
    s.hover && s.hover.kind !== 'point' && s.hover.formId !== id ? null : s.hover,
  )
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
  // Track the live gesture: while hover is actually reporting a position on
  // THIS edge, the slot is wherever a new point would be inserted right now
  // (forms.ts's insertionIndex — the same math addPoint's call sites use);
  // once hover clears mid-drag, hold the last live slot instead of reverting
  // to a fixed "always append" position, so the origin doesn't jump away
  // from where the user grabbed. Slot is an integer 0..count, so it only
  // changes when the cursor crosses into a different insertion interval —
  // not on every pixel.
  const phantomSlot = (() => {
    if (!phantomEdgeKey) return null
    if (hoverEdgeKey === phantomEdgeKey && hoverRx != null && hoverRy != null) {
      lastPhantomSlotRef.current = insertionIndex(form, phantomEdgeKey, hoverRx, hoverRy)
      return lastPhantomSlotRef.current
    }
    return lastPhantomSlotRef.current ?? pointIdsAt(form, phantomEdgeKey).length
  })()
  // The phantom Handle mounts/unmounts/moves on every hover change — React
  // Flow only re-measures handle bounds via a ResizeObserver on the node's
  // overall box, which a child appearing/disappearing doesn't trigger (the
  // node's own n×n size never changes), so a just-mounted phantom is
  // invisible to React Flow's own connection-start hit-testing until this
  // nudges it to re-scan. Same fix rotation already needed above.
  // phantomSlot is a dep: the handle MOVES when the slot changes, and React
  // Flow would otherwise keep the stale measured position as the connection
  // line's origin even though the visible dot tracked the cursor.
  useEffect(() => { updateNodeInternals(id) }, [id, phantomEdgeKey, phantomSlot, updateNodeInternals])

  // Select a point (from its glyph/grab handle OR its name): exclusive with form
  // selection; Cmd/Ctrl+click accumulates, plain click single-selects.
  const selectPoint = (e: React.MouseEvent, pid: string) => {
    e.stopPropagation()
    setNodes((nds) => (nds.some((nd) => nd.selected) ? nds.map((nd) => (nd.selected ? { ...nd, selected: false } : nd)) : nds))
    if (e.metaKey || e.ctrlKey) toggleSelectedPoint(pid)
    else setSelectedPoints([pid])
  }

  const pointVisuals: React.ReactNode[] = []
  // Every RESIDENT point whose glyph actually renders something (shape !==
  // 'empty') gaps the body's border/fill at its anchor — see BodyView. An
  // 'empty'-shaped point draws no glyph, so it must NOT gap (nothing would
  // fill the hole, leaving a stray break in the outline).
  const gapPoints: Array<{ x: number; y: number; gapBody: Body }> = []
  for (const edgeKey of geom.edgeKeys) {
    const ids = pointIdsAt(form, edgeKey)
    ids.forEach((pid, index) => {
      const pt = points[pid]
      if (!pt) return
      const anchor = geom.pointAnchor(edgeKey, index, ids.length, n)
      const labelSplay = edgeLabelSplay(geom, edgeKey, index, ids.length, n)
      // gapBody is the POINT's own shape geometry (not the parent form's) —
      // the cutout must match what's actually sitting there.
      if (pt.shape !== 'empty') gapPoints.push({ x: anchor.x, y: anchor.y, gapBody: geometryFor(pt.shape).body })
      const isSel = selectedPoints.includes(pid)
      const hid = encodeHandle(edgeKey, index)
      // A point's own drag-region hover always wins over the form's
      // region/center hover (decided centrally in Canvas.tsx's
      // nearestPointWithin) — a selected point gets the darker tint instead,
      // quiver's hover/select language, not the blue form-selection accent.
      const isHovered = hover?.kind === 'point' && hover.pointId === pid
      pointVisuals.push(
        <PointVisual
          key={`pt-${pid}`}
          pid={pid}
          pt={pt}
          anchor={anchor}
          labelSplay={labelSplay}
          hid={hid}
          isSelected={isSel}
          isHovered={isHovered}
          formRotation={form.rotation ?? 0}
          onSelect={selectPoint}
        />,
      )
    })
  }

  return (
    <div style={{
      position: 'relative', width: n, height: n, cursor: 'pointer',
      transform: form.rotation ? `rotate(${form.rotation}deg)` : undefined,
      // CSS defaults transform-origin to the BBOX center (50% 50%), but a
      // triangle's true centroid sits off toward its base (see forms.ts's
      // bodyCentroid) — an un-pivoted rotate() swings the whole node/points/
      // name assembly around a point that isn't visually "the middle" of an
      // asymmetric body, so it appears to pivot around the wrong spot.
      // Square/circle/rhombus/empty have centroid === bbox-center by
      // construction, so this is a no-op for them; only triangle visibly
      // moves. ir/geometry-ir.ts's layoutForm derives its own export-path
      // rotation pivot from the SAME bodyCentroid, so canvas and exports
      // agree on where "center" is.
      transformOrigin: `${centroid[0] * 100}% ${centroid[1] * 100}%`,
    }}>
      <BodyView body={geom.body} n={n} accent={accent} selected={!!selected} bodyOpacity={geom.bodyOpacity} hasCenterZone={geom.hasCenterZone} gapPoints={gapPoints} maskId={`body-gap-${id}`} />
      {/* dragHandle hit-area (see Canvas.tsx's node-building) — kinds with no
          center zone ('empty') stay draggable from anywhere, matching their
          existing "whole body is one region" behavior. */}
      {geom.hasCenterZone && <DragHandleZone body={geom.body} n={n} />}
      {/* point-creation region hover — quiver-style: shows which edge a
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
          onConnect(End) the moment a connection actually completes.
          Skipped entirely for pointIsForm shapes ('empty'): its body can
          only be a DROP target, never spawn a NEW point/wire by dragging
          from empty space on it — its one point IS the form, so there's
          nothing left to fan out anyway, and mounting no phantom here is
          also what frees the whole body back up for plain React Flow
          node-dragging (see BodyView's `decorative` — a form with no center
          zone stays pointer-clickable everywhere, and without a Handle
          covering it, a press there starts a node drag instead of a
          connection drag). The one middle point ITSELF, once it exists, is
          a real point Handle like any other kind's — see above — so
          dragging FROM it does start a wire. An ordinary optional
          capacity-1 slot WITHOUT pointIsForm (triangle's peak) keeps its
          phantom — it's a normal (if capped) attachment point, just like any
          other edge. */}
      {!geom.pointIsForm && phantomEdgeKey && phantomSlot != null && (() => {
        const count = pointIdsAt(form, phantomEdgeKey).length
        const anchor = geom.pointAnchor(phantomEdgeKey, phantomSlot, count + 1, n)
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
