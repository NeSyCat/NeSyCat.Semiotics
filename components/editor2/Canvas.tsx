'use client'

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  Background,
  BackgroundVariant,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type NodeChange,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import FormNode, { DRAG_HANDLE_CLASS } from './FormNode'
import LineEdge from './LineEdge'
import { useStore, initStore } from './store'
import { useAutosave, useLocalAutosave } from './save'
import { geometryFor, pointIdsAt, isInsideBody, isInCenterZone, insertionIndex, BASE_SIZE, type FormGeometry } from './forms'
import { encodeHandle, decodeHandle, decodePhantomHandle } from './handles'
import { GRID_SIZE, snapCenterPosition } from './grid'
import ImportPanel from './ImportPanel'
import { encodeDiagramToFragment } from './share'
import { diagramToTikz } from './tikz'
import { diagramToHtml } from './html'
import theme from './theme'
import type { Diagram, Form, FormKind, PointShape, Color } from './types'
import { toCssRgb } from './color'

const nodeTypes: NodeTypes = { form: FormNode }
const edgeTypes: EdgeTypes = { line: LineEdge }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// A form's CSS rotation is purely visual — its node box/position stay in the
// unrotated flow frame. Edge/corner hit-testing (double-click to add a point,
// drag-drop to auto-attach a line) needs the INVERSE of that rotation applied
// to the click point first, or a click on what's now visually the right side
// resolves against where the right side used to be before rotating.
function unrotateLocal(localX: number, localY: number, w: number, h: number, rotationDeg: number): [number, number] {
  if (!rotationDeg) return [localX, localY]
  const theta = (rotationDeg * Math.PI) / 180
  const cx = w / 2, cy = h / 2
  const vx = localX - cx, vy = localY - cy
  const ux = vx * Math.cos(theta) + vy * Math.sin(theta)
  const uy = -vx * Math.sin(theta) + vy * Math.cos(theta)
  return [cx + ux, cy + uy]
}

// Node-local point (rotation-aware) → normalized [0,1]² fraction, given a
// flow-space point and the target node/Form. Shared by every point-creation
// gesture path — double-click, drop-attach (resolveDropPoint), and the
// stashed ring-drag-start position (resolvePointForHandle's phantom branch)
// — so "which side of an existing point did the gesture land on" resolves
// through ONE conversion, not three inline copies.
function nodeLocalFraction(
  flowX: number, flowY: number, node: Node, form: Form,
): { rx: number; ry: number; lx: number; ly: number; n: number } {
  const geom = geometryFor(form.kind)
  const n = node.measured?.width ?? node.width ?? geom.nodeSize(form) * (form.scale ?? 1)
  const [lx, ly] = unrotateLocal(flowX - node.position.x, flowY - node.position.y, n, n, form.rotation ?? 0)
  return { rx: lx / n, ry: ly / n, lx, ly, n }
}

// Radius (local/unrotated px) within which an existing point's own drag
// handle takes priority over the form's region/center hover — see
// nearestPointWithin below.
const POINT_HOVER_RADIUS = 14

// The closest existing point on `form` to a local pixel (lx, ly), if within
// POINT_HOVER_RADIUS — checked BEFORE any inside/outside or center-zone
// test, since a point's own anchor sits ON the body's boundary and its
// hit-circle straddles both sides of it.
function nearestPointWithin(form: Form, geom: FormGeometry, lx: number, ly: number, n: number): string | null {
  let best: string | null = null
  let bestDist = POINT_HOVER_RADIUS
  for (const edgeKey of geom.edgeKeys) {
    const ids = pointIdsAt(form, edgeKey)
    ids.forEach((pid, index) => {
      const a = geom.pointAnchor(edgeKey, index, ids.length, n)
      const dist = Math.hypot(lx - a.x, ly - a.y)
      if (dist < bestDist) { bestDist = dist; best = pid }
    })
  }
  return best
}

// Resolves a screen drop position into a point id — an existing form under
// the cursor gets a NEW point at its nearest edge/corner; empty canvas spins
// up a fresh "empty" carrier (with its own point) to land on, so pulling a
// wire out into space works without placing a shape first. Shared by the
// Handle-based connection drag (onConnectEnd) and the ring-drag (pulling a
// line straight out of a point-creation region that has no point yet).
function resolveDropPoint(
  clientX: number, clientY: number, excludeFormId: string,
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number },
  getNodes: () => Node[],
): string | null {
  const position = screenToFlowPosition({ x: clientX, y: clientY })
  const dropTarget = getNodes().find((node) => {
    if (node.id === excludeFormId || node.type !== 'form') return false
    const w = node.measured?.width ?? node.width ?? 0
    const h = node.measured?.height ?? node.height ?? 0
    return (
      position.x >= node.position.x && position.x <= node.position.x + w &&
      position.y >= node.position.y && position.y <= node.position.y + h
    )
  })
  if (!dropTarget) {
    const size = BASE_SIZE / 2 // matches emptyGeometry's nodeSize
    const newFormId = useStore.getState().addForm('empty', { x: position.x - size / 2, y: position.y - size / 2 })
    return useStore.getState().addPoint(newFormId, 'self') || null
  }
  const d = useStore.getState().diagram
  const targetForm = d.forms.find((f) => f.id === dropTarget.id)
  if (!targetForm) return null
  const geom = geometryFor(targetForm.kind)
  const { rx, ry } = nodeLocalFraction(position.x, position.y, dropTarget, targetForm)
  // Dropped in the center zone — that's the whole-form-selection region, not
  // point-creation territory, so this is a no-op, same as a center-zone
  // double-click.
  if (geom.hasCenterZone && isInCenterZone(geom.body, rx, ry)) return null
  const edgeKey = geom.edgeAt(clamp01(rx), clamp01(ry))
  if (!edgeKey) return null
  const index = insertionIndex(targetForm, edgeKey, clamp01(rx), clamp01(ry))
  return useStore.getState().addPoint(dropTarget.id, edgeKey, undefined, index) || null
}

// point id -> { nodeId, handleId } (the form it sits on + its handle).
function pointToHandle(d: Diagram, pointId: string): { nodeId: string; handleId: string } | undefined {
  const pt = d.points[pointId]
  if (!pt) return undefined
  const form = d.forms.find((f) => f.id === pt.formId)
  if (!form) return undefined
  const idx = pointIdsAt(form, pt.edgeKey).indexOf(pointId)
  if (idx < 0) return undefined
  return { nodeId: form.id, handleId: encodeHandle(pt.edgeKey, idx) }
}

// (nodeId, handleId) -> point id.
function handleToPointId(d: Diagram, nodeId: string, handleId: string): string | undefined {
  const form = d.forms.find((f) => f.id === nodeId)
  if (!form) return undefined
  const { edgeKey, index } = decodeHandle(handleId)
  return pointIdsAt(form, edgeKey)[index]
}

// Resolves a real OR phantom handle into a point id — a phantom handle (the
// point-creation ring's hover-only placeholder, no point there yet) gets a
// real point created on the spot via addPoint, the same mutation double-
// click uses. Reads the diagram fresh each time since creating one phantom
// point (in a source+target pair, e.g. two ring positions on the same form)
// must not resolve the other end against a stale pre-creation snapshot.
//
// `gesturePoint` is the client (screen) coords of where the DRAG STARTED
// (stashed by onConnectStart) — passed only for the "from" side of a
// connection, where it's a real gesture position; omitted for the "to" side
// (there's no equivalently reliable position for where a completed
// connection landed exactly on a phantom handle), which falls back to a
// plain append, same as before this feature.
function resolvePointForHandle(
  nodeId: string, handleId: string,
  gesturePoint: { clientX: number; clientY: number } | null | undefined,
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number },
  getNodes: () => Node[],
): string | undefined {
  const phantomEdgeKey = decodePhantomHandle(handleId)
  if (!phantomEdgeKey) return handleToPointId(useStore.getState().diagram, nodeId, handleId)
  if (gesturePoint) {
    const node = getNodes().find((n) => n.id === nodeId)
    const form = useStore.getState().diagram.forms.find((f) => f.id === nodeId)
    if (node && form) {
      const flow = screenToFlowPosition({ x: gesturePoint.clientX, y: gesturePoint.clientY })
      const { rx, ry } = nodeLocalFraction(flow.x, flow.y, node, form)
      const index = insertionIndex(form, phantomEdgeKey, clamp01(rx), clamp01(ry))
      return useStore.getState().addPoint(nodeId, phantomEdgeKey, undefined, index) || undefined
    }
  }
  return useStore.getState().addPoint(nodeId, phantomEdgeKey) || undefined
}

// SVG sprite — copied verbatim from _design/04-prototype (the mockup). The DS
// `.pill .btn svg` rule paints these fill:none / stroke:currentColor.
function ToolbarSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="ic-direction-center" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
        </symbol>
        <symbol id="ic-weight" viewBox="0 0 24 24">
          <path d="M9 7a3 3 0 1 1 6 0" />
          <path d="M7 9h10l1.6 11H5.4z" />
        </symbol>
        <symbol id="ic-scale" viewBox="0 0 24 24" fill="none">
          <path d="M9 4H4v5M15 20h5v-5M4 4l6 6M20 20l-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform="rotate(90 12 12)" />
        </symbol>
        <symbol id="ic-rotation" viewBox="0 0 24 24" fill="none">
          <path d="M19 12a7 7 0 1 1-2.05-4.95" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M19 4v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="ic-location" viewBox="0 0 24 24">
          <path d="M12 3v18M3 12h18" />
          <path d="M12 3l-2 2.5M12 3l2 2.5" />
          <path d="M12 21l-2-2.5M12 21l2-2.5" />
          <path d="M3 12l2.5-2M3 12l2.5 2" />
          <path d="M21 12l-2.5-2M21 12l-2.5 2" />
        </symbol>
        <symbol id="ic-eye" viewBox="0 0 24 24" fill="none">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
        </symbol>
        <symbol id="ic-eye-off" viewBox="0 0 24 24" fill="none">
          <path d="M9.9 5.14A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a13.3 13.3 0 0 1-3.05 3.9m-2.87 1.9A10.7 10.7 0 0 1 12 19c-6.4 0-10-7-10-7a13.3 13.3 0 0 1 4.22-4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.9 14.1a3 3 0 0 0 4.24-4.24" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </symbol>
        <symbol id="ic-grid" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="1" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="currentColor" strokeWidth="1.7" />
        </symbol>
        <symbol id="ic-export" viewBox="0 0 24 24" fill="none">
          <path d="M12 15V4M12 4L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        {/* Mirror of ic-export — same tray, arrow pointing the OTHER way (down,
            into the tray) for "bring something in". */}
        <symbol id="ic-import" viewBox="0 0 24 24" fill="none">
          <path d="M12 4v11M12 15l-4.5-4.5M12 15l4.5-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="ic-check" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="kind-empty" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2.6" />
        </symbol>
        <symbol id="kind-point" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.15" fill="currentColor" /></symbol>
        <symbol id="kind-line" viewBox="0 0 24 24"><path d="M2.75 12L21.25 12" fill="none" stroke="currentColor" strokeLinecap="round" /></symbol>
        <symbol id="kind-triangle" viewBox="0 0 24 24"><path d="M21.25 12L7.375 20.011L7.375 3.989Z" /></symbol>
        <symbol id="kind-rhombus" viewBox="0 0 24 24"><path d="M12 2.75L21.25 12L12 21.25L2.75 12Z" /></symbol>
        <symbol id="kind-pentagon" viewBox="0 0 24 24"><path d="M12 2.75 L20.797 9.142 L17.437 19.483 L6.563 19.483 L3.203 9.142 Z" /></symbol>
        <symbol id="kind-hexagon" viewBox="0 0 24 24"><path d="M12 2.75 L20.011 7.375 L20.011 16.625 L12 21.25 L3.989 16.625 L3.989 7.375 Z" /></symbol>
        <symbol id="kind-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.25" /></symbol>
        <symbol id="kind-rectangle" viewBox="0 0 24 24"><rect x="2.75" y="2.75" width="18.5" height="18.5" rx="0" ry="0" /></symbol>
      </defs>
    </svg>
  )
}

// Top Spine pill — the mockup's categories (exact symbols / value glyphs).
// Only "shape" opens a working second toolbar; the rest are placeholders.
// Direction/Weight/Order are disabled for now — kept out of this list so
// they don't render in the pill.
const CATEGORIES: Array<{ key: string; label: string; content: React.ReactNode }> = [
  { key: 'scale', label: 'Scale', content: <svg aria-hidden="true"><use href="#ic-scale" /></svg> },
  { key: 'rotation', label: 'Rotation', content: <svg aria-hidden="true"><use href="#ic-rotation" /></svg> },
  { key: 'location', label: 'Location', content: <svg aria-hidden="true"><use href="#ic-location" /></svg> },
  // Static fallback content — actually rendered dynamically below (the pill
  // maps 'color' to a disk showing the selection's shared colour).
  { key: 'color', label: 'Color', content: <span style={{ width: 18, height: 18, borderRadius: '50%', background: 'transparent', display: 'block' }} /> },
  { key: 'shape', label: 'Shape', content: <svg aria-hidden="true"><use href="#kind-hexagon" /></svg> },
  { key: 'name', label: 'Name', content: <span style={{ fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}>Aa</span> },
]

// Second toolbar — the Shape rail. Every tile sets the shape of the SELECTED
// POINT(S). For FORMS, only tiles with a `kind` are functional; the rest are
// point-only placeholders. Line/Pentagon/Hexagon are disabled for now — kept
// out of this list so they don't render in the pill, but PointShape in
// types.ts still includes them so pre-existing diagram data isn't affected.
const SHAPE_RAIL: Array<{ label: string; symbol: string; pshape: PointShape; kind?: FormKind }> = [
  { label: 'Empty', symbol: 'kind-empty', pshape: 'empty', kind: 'empty' },
  { label: 'Point', symbol: 'kind-point', pshape: 'point', kind: 'point' },
  { label: 'Triangle', symbol: 'kind-triangle', pshape: 'triangle', kind: 'triangle' },
  { label: 'Rhombus', symbol: 'kind-rhombus', pshape: 'rhombus', kind: 'rhombus' },
  { label: 'Circle', symbol: 'kind-circle', pshape: 'circle', kind: 'circle' },
  { label: 'Square', symbol: 'kind-rectangle', pshape: 'square', kind: 'square' },
]

// Second toolbar — the Color rail. Applies to the SELECTION (points > forms >
// lines, same priority as the Name field). Hues are HSL 0/30/60/120/180/210/
// 240/300 at 100% S, 50% L, per spec; White closes out the row. White IS the
// default: it maps to `null`, clearing the target back to the undefined
// default (transparent form fill / ink glyphs / black lines) — an uncolored
// target reads as White in the rail and the top-pill icon.
const COLOR_RAIL: Array<{ label: string; color: Color | null }> = [
  { label: 'Red', color: [1, 0, 0] },
  { label: 'Orange', color: [1, 0.5, 0] },
  { label: 'Yellow', color: [1, 1, 0] },
  { label: 'Green', color: [0, 1, 0] },
  { label: 'Cyan', color: [0, 1, 1] },
  { label: 'Azure', color: [0, 0.5, 1] },
  { label: 'Blue', color: [0, 0, 1] },
  { label: 'Magenta', color: [1, 0, 1] },
  { label: 'White', color: null },
]

// Value-compares two colors — null/undefined both mean the White default and
// count as equal, so a mixed selection of one never-coloured form and one
// White-reset point still reads as a shared default state.
function sameColor(a: Color | null | undefined, b: Color | null | undefined): boolean {
  if (!a || !b) return !a && !b
  return a[0] === b[0] && a[1] === b[1] && a[2] === b[2]
}

// Shared disk styling for both the Color-rail swatches and the top-pill
// Color icon — no color means the White default, so the disk is never
// anything but a plain color. `active` swaps the inset ring to white so it
// stays visible against the .is-active button's primary-blue fill.
function swatchStyle(color: Color | null | undefined, active: boolean, size: number): React.CSSProperties {
  return {
    width: size,
    height: size,
    borderRadius: '50%',
    display: 'block',
    background: color ? toCssRgb(color) : '#ffffff',
    boxShadow: active ? 'inset 0 0 0 1px rgba(255,255,255,0.85)' : 'inset 0 0 0 1px rgba(0,0,0,0.12)',
  }
}

// Which toolbar tool/category is active is a UI preference, not diagram data —
// persisted to localStorage (not the store/history) so it survives a reload
// without becoming an undo step or part of the saved diagram.
const ACTIVE_KIND_KEY = 'nesycat.editor.activeKind'
const ACTIVE_COLOR_KEY = 'nesycat.editor.activeColor'
const ACTIVE_CATEGORY_KEY = 'nesycat.editor.activeCategory'

function readLocalStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeLocalStorage(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* e.g. storage disabled/full — just don't persist */ }
}

// The Name category's second pill — the whole pill is a text input that renames
// the current selection live (one undo step, via the store's coalescing). `sig`
// changes when the selection changes, re-seeding the field.
function NameField({ sig, initial, placeholder, disabled, onChange }: {
  sig: string; initial: string; placeholder: string; disabled: boolean; onChange: (v: string) => void
}) {
  const [val, setVal] = useState(initial)
  useEffect(() => { setVal(initial) }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text"
      autoFocus
      disabled={disabled}
      value={disabled ? '' : val}
      placeholder={placeholder}
      onChange={(e) => { setVal(e.target.value); onChange(e.target.value) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
      style={{
        width: '100%', height: 36, boxSizing: 'border-box',
        background: 'transparent', border: 'none', outline: 'none',
        fontSize: 14, padding: '0 12px', color: 'var(--color-foreground)',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
    />
  )
}

// Slider drags snap to the right angles when within this many degrees, so
// landing on an exact 0/90/180/270/360 is easy without fighting the mouse.
// 360 is kept as its own hit (not wrapped to 0) so the slider can actually
// reach — and display — its right edge; onChange still wraps it to 0 when
// it's committed to the diagram (see RotationField.apply below).
const RIGHT_ANGLES = [0, 90, 180, 270, 360]
const SNAP_TOLERANCE = 12
function snapToRightAngle(v: number): number {
  const hit = RIGHT_ANGLES.find((a) => Math.abs(v - a) <= SNAP_TOLERANCE)
  return hit === undefined ? v : hit
}

// The Rotation category's second pill — a 0-360° slider over the selected
// form(s) (mirrors the mockup's bounds slider), plus a directly-editable
// degree readout. `sig` re-seeds the field when the selection changes, same
// coalescing-drag pattern as NameField. The slider's right edge is a real,
// reachable 360 (not silently folded into 0) so a full-turn drag doesn't
// visually snap backwards mid-gesture — 360 and 0 are the same rotation, but
// only the STORED value wraps; the live readout keeps whichever the user
// dragged to.
function RotationField({ sig, initial, disabled, onChange }: {
  sig: string; initial: number; disabled: boolean; onChange: (v: number) => void
}) {
  const [val, setVal] = useState(initial)
  const [text, setText] = useState(String(initial))
  useEffect(() => { setVal(initial); setText(String(initial)) }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (deg: number) => {
    const rounded = Math.round(deg)
    // A full turn (any nonzero multiple of 360) reads as 360, not 0 — the
    // wrap to 0 still happens on the way into the store (setFormsRotation).
    const wrapped = rounded !== 0 && rounded % 360 === 0 ? 360 : ((rounded % 360) + 360) % 360
    setVal(wrapped)
    setText(String(wrapped))
    onChange(wrapped)
  }
  const commitText = () => {
    const n = Number(text)
    if (Number.isFinite(n)) apply(n)
    else setText(String(val))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 36, padding: '0 14px', boxSizing: 'border-box' }}>
      <input
        type="range"
        min={0}
        max={360}
        step={1}
        disabled={disabled}
        value={disabled ? 0 : val}
        onChange={(e) => apply(snapToRightAngle(Number(e.target.value)))}
        style={{ flex: 1 }}
      />
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={disabled ? '—' : text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setText(String(val)); (e.target as HTMLInputElement).blur() }
        }}
        style={{
          width: 28, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums',
          background: 'transparent', border: 'none', outline: 'none', padding: 0,
          color: disabled ? 'var(--color-muted-foreground)' : 'var(--color-foreground)',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        }}
      />
      <span style={{ fontSize: 13, color: disabled ? 'var(--color-muted-foreground)' : 'var(--color-foreground)' }}>°</span>
    </div>
  )
}

// Slider drags snap to the round hundreds (100/200/300/400%) when within
// this many percentage points, so landing on an exact multiple — including
// the "no scaling" 100% default — is easy without fighting the mouse. Same
// idea (and same tolerance strength) as rotation's snapToRightAngle/RIGHT_ANGLES.
const SCALE_MARKS = [100, 200, 300, 400]
const SCALE_SNAP_TOLERANCE = SNAP_TOLERANCE
function snapToScaleMark(v: number): number {
  const hit = SCALE_MARKS.find((m) => Math.abs(v - m) <= SCALE_SNAP_TOLERANCE)
  return hit === undefined ? v : hit
}

// The Scale category's second pill — a 25-400% slider over the selected
// form(s), plus a directly-editable percent readout. `sig` re-seeds the field
// when the selection changes, same coalescing-drag pattern as RotationField.
function ScaleField({ sig, initial, disabled, onChange }: {
  sig: string; initial: number; disabled: boolean; onChange: (v: number) => void
}) {
  const [val, setVal] = useState(initial)
  const [text, setText] = useState(String(initial))
  useEffect(() => { setVal(initial); setText(String(initial)) }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (pct: number) => {
    const clamped = Math.max(25, Math.min(400, Math.round(pct)))
    setVal(clamped)
    setText(String(clamped))
    onChange(clamped)
  }
  const commitText = () => {
    const n = Number(text)
    if (Number.isFinite(n)) apply(n)
    else setText(String(val))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 36, padding: '0 14px', boxSizing: 'border-box' }}>
      <input
        type="range"
        min={25}
        max={400}
        step={5}
        disabled={disabled}
        value={disabled ? 100 : val}
        onChange={(e) => apply(snapToScaleMark(Number(e.target.value)))}
        style={{ flex: 1 }}
      />
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={disabled ? '—' : text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setText(String(val)); (e.target as HTMLInputElement).blur() }
        }}
        style={{
          width: 28, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums',
          background: 'transparent', border: 'none', outline: 'none', padding: 0,
          color: disabled ? 'var(--color-muted-foreground)' : 'var(--color-foreground)',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        }}
      />
      <span style={{ fontSize: 13, color: disabled ? 'var(--color-muted-foreground)' : 'var(--color-foreground)' }}>%</span>
    </div>
  )
}

// A small inline copy glyph — not the sprite's ic-check (that's reserved for
// the row's own post-copy confirmation state, swapped in locally below).
function CopyGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// One row of the Export dropdown — a label (monospace, "$...$"-free plain
// text, not KaTeX — this is chrome, not diagram content) on the left, a
// copy icon on the right; the whole row is clickable. Swaps to a checkmark
// briefly after a successful copy, per-row (independent of its siblings).
function ExportRow({ label, getText }: { label: string; getText: () => Promise<string> }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    const text = await getText()
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('Copy this:', text)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }
  return (
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
        width: '100%', height: 30, padding: '0 8px', border: 'none', background: 'transparent', cursor: 'pointer',
        borderRadius: 'var(--radius-sm, 6px)', color: 'var(--color-foreground)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 13 }}>{label}</span>
      {copied ? <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#ic-check" /></svg> : <CopyGlyph />}
    </button>
  )
}

// The Export button's hover/click dropdown — narrow, three rows (URL / Text
// / HTML), each just a label + copy icon. Deliberately NOT a code-preview
// panel: same round-trip-copy idiom the Import button pairs with.
//
// The copied URL must use the ID-LESS editor base (editor-url.ts's
// serverEditorHref() with no id) — NOT the current pathname: on a signed-in
// diagram page the pathname is /editor/<id> (or /<id> on the subdomain),
// and a recipient opening that path hits the owner's RLS-guarded row — 404
// for signed-in recipients, whose ImportSharedHash never mounts across the
// not-found boundary (it also leaks the private row id). The base path is
// what both import flows listen on. Client-side derivation of that base:
// every host that serves the editor is either single-host/preview (paths
// under /editor) or the production subdomain (paths at /), so the prefix
// alone decides — same output as editorHrefForHost(host) for those hosts.
function shareBasePath(): string {
  return location.pathname.startsWith('/editor') ? '/editor' : '/'
}

function ExportMenu({ diagram }: { diagram: Diagram }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openMenu = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(true)
  }
  const scheduleClose = () => { closeTimer.current = setTimeout(() => setOpen(false), 150) }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      // Cast to HTMLElement, not the DOM `Node` type — this file already
      // imports React Flow's OWN `Node` (the flow-graph node type), which
      // shadows the ambient DOM one for bare references here.
      if (wrapRef.current && !wrapRef.current.contains(e.target as HTMLElement)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  return (
    <div ref={wrapRef} onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
      <button
        className="btn btn-icon"
        title="Export"
        aria-label="Export"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg aria-hidden="true"><use href="#ic-export" /></svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 8, zIndex: 20, minWidth: 116,
            background: 'var(--color-card)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md, 10px)', boxShadow: 'var(--shadow-md)', padding: 4,
            display: 'flex', flexDirection: 'column',
          }}
        >
          <ExportRow label="LaTeX" getText={() => diagramToTikz(diagram)} />
          <ExportRow
            label="URL"
            getText={async () => {
              const frag = await encodeDiagramToFragment(diagram)
              return `${location.origin}${shareBasePath()}#${frag}`
            }}
          />
          <ExportRow label="HTML" getText={() => diagramToHtml(diagram)} />
        </div>
      )}
    </div>
  )
}

interface CanvasContentProps {
  topRight?: ReactNode
}

function Canvas({ topRight }: CanvasContentProps) {
  const diagram = useStore((s) => s.diagram)
  const clearSelection = useStore((s) => s.clearSelection)
  const renameForms = useStore((s) => s.renameForms)
  const renamePoints = useStore((s) => s.renamePoints)
  const renameLines = useStore((s) => s.renameLines)
  const selectedPoints = useStore((s) => s.selectedPoints)
  const pointsVisible = useStore((s) => s.pointsVisible)
  const togglePointsVisible = useStore((s) => s.togglePointsVisible)
  const gridEnabled = useStore((s) => s.gridEnabled)
  const toggleGridEnabled = useStore((s) => s.toggleGridEnabled)
  const [importOpen, setImportOpen] = useState(false)
  const { screenToFlowPosition, getNodes } = useReactFlow()

  const [activeKind, setActiveKind] = useState<FormKind>(() => {
    const stored = readLocalStorage(ACTIVE_KIND_KEY)
    return stored && SHAPE_RAIL.some((s) => s.kind === stored) ? (stored as FormKind) : 'square'
  })
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    const stored = readLocalStorage(ACTIVE_CATEGORY_KEY)
    return stored != null && (stored === '' || CATEGORIES.some((c) => c.key === stored)) ? stored : 'shape'
  })
  useEffect(() => { writeLocalStorage(ACTIVE_KIND_KEY, activeKind) }, [activeKind])

  // The active color — the creation default, exactly like activeKind: new
  // forms are born with it, and the Color rail edits it when nothing is
  // selected. null = the White default.
  const [activeColor, setActiveColor] = useState<Color | null>(() => {
    const stored = readLocalStorage(ACTIVE_COLOR_KEY)
    if (!stored) return null
    try {
      const v = JSON.parse(stored)
      if (Array.isArray(v) && v.length === 3 && v.every((n) => Number.isFinite(n) && n >= 0 && n <= 1)) return v as Color
    } catch { /* malformed — fall through to the default */ }
    return null
  })
  useEffect(() => { writeLocalStorage(ACTIVE_COLOR_KEY, JSON.stringify(activeColor)) }, [activeColor])
  useEffect(() => { writeLocalStorage(ACTIVE_CATEGORY_KEY, activeCategory) }, [activeCategory])

  // The shape shared by all selected points (for the rail highlight), if any.
  const selectedPointShape = useMemo<PointShape | undefined>(() => {
    if (selectedPoints.length === 0) return undefined
    const shapes = new Set(selectedPoints.map((id) => diagram.points[id]?.shape).filter(Boolean))
    return shapes.size === 1 ? ([...shapes][0] as PointShape) : undefined
  }, [selectedPoints, diagram.points])

  // The top-pill Shape icon mirrors the active/selected form's shape.
  const activeKindSymbol = SHAPE_RAIL.find((s) => s.kind === activeKind)?.symbol ?? 'kind-hexagon'

  // ── Build RF nodes from forms ──────────────────────────────────────
  const builtNodes: Node[] = useMemo(() => {
    return diagram.forms.map((form) => ({
      id: form.id,
      type: 'form',
      position: form.position,
      data: { form, points: diagram.points },
      // Native dragging only from the center zone (FormNode's always-present
      // DragHandleZone) — the ring is exclusively point-creation/line-pulling
      // territory. Kinds with no center zone (point/empty) keep the whole
      // node draggable, matching their existing "one shared region" model.
      ...(geometryFor(form.kind).hasCenterZone ? { dragHandle: `.${DRAG_HANDLE_CLASS}` } : {}),
    }))
  }, [diagram])

  // ── Build RF edges from lines (one RF edge per target) ─────────────
  const builtEdges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (const line of diagram.lines) {
      const sp = pointToHandle(diagram, line.source)
      if (!sp) continue
      line.targets.forEach((tid, i) => {
        const tp = pointToHandle(diagram, tid)
        if (!tp) return
        out.push({
          id: `${line.id}#${i}`,
          source: sp.nodeId,
          sourceHandle: sp.handleId,
          target: tp.nodeId,
          targetHandle: tp.handleId,
          type: 'line',
          animated: true,
          data: { label: line.name ?? line.id, color: line.color },
        })
      })
    }
    return out
  }, [diagram])

  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  // Grid ON: snap LIVE, mid-drag — intercepting 'position' changes here
  // (rather than only at drag-stop) is what makes the form visually jump
  // from grid dot to grid dot WHILE dragging, quiver-style. Deliberately NOT
  // React Flow's own snapToGrid prop: that snaps a node's top-left corner,
  // but node size varies per kind/scale/point-count, so top-left isn't the
  // form's actual visual center — snapCenterPosition (grid.ts) is.
  const onNodesChangeSnapped = useCallback((changes: NodeChange[]) => {
    if (!gridEnabled) { onNodesChange(changes); return }
    const d = useStore.getState().diagram
    onNodesChange(changes.map((c) => {
      if (c.type !== 'position' || !c.position) return c
      const form = d.forms.find((f) => f.id === c.id)
      if (!form) return c
      return { ...c, position: snapCenterPosition(form, c.position) }
    }))
  }, [gridEnabled, onNodesChange])

  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]))
      return builtNodes.map((bn) => {
        const existing = prevById.get(bn.id)
        if (!existing) return bn
        const position = existing.dragging ? existing.position : bn.position
        return { ...bn, position, selected: existing.selected, dragging: existing.dragging }
      })
    })
  }, [builtNodes, setNodes])

  useEffect(() => {
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e]))
      return builtEdges.map((be) => {
        const existing = prevById.get(be.id)
        return existing ? { ...be, selected: existing.selected } : be
      })
    })
  }, [builtEdges, setEdges])

  // ── Selection target: the current selection (points > forms > lines).
  // Pure selection state — shared by the Name field AND the Color rail,
  // whose targeting is identical. ─────────────────────────────────────
  const selectionTarget = useMemo(() => {
    const formIds = nodes.filter((n) => n.selected).map((n) => n.id)
    const lineIds = [...new Set(edges.filter((e) => e.selected).map((e) => String(e.id).split('#')[0]))]
    if (selectedPoints.length) return { kind: 'points' as const, ids: selectedPoints }
    if (formIds.length) return { kind: 'forms' as const, ids: formIds }
    if (lineIds.length) return { kind: 'lines' as const, ids: lineIds }
    return null
  }, [nodes, edges, selectedPoints])

  const nameInfo = useMemo(() => {
    if (!selectionTarget) return { value: '', placeholder: 'Select a form, point, or line', sig: '', disabled: false }
    // An 'empty' form carries no name of its own — its one middle point IS
    // the form (see forms.ts's emptyGeometry), so renaming/reading the name
    // field retargets to that point instead of the form. No point yet
    // (nothing's been dropped on it) -> nothing to rename; blank + disabled.
    if (selectionTarget.kind === 'forms' && selectionTarget.ids.length === 1) {
      const form = diagram.forms.find((f) => f.id === selectionTarget.ids[0])
      if (form?.kind === 'empty') {
        const midId = pointIdsAt(form, geometryFor(form.kind).edgeKeys[0])[0]
        if (!midId) return { value: '', placeholder: '', sig: 'empty:' + form.id, disabled: true }
        return { value: diagram.points[midId]?.name ?? '', placeholder: midId, sig: 'points:' + midId, disabled: false }
      }
    }
    const id0 = selectionTarget.ids[0]
    const single = selectionTarget.ids.length === 1
    const name = selectionTarget.kind === 'points' ? diagram.points[id0]?.name
      : selectionTarget.kind === 'forms' ? diagram.forms.find((f) => f.id === id0)?.name
        : diagram.lines.find((l) => l.id === id0)?.name
    return {
      value: single ? (name ?? '') : '',
      placeholder: single ? id0 : `${selectionTarget.ids.length} ${selectionTarget.kind}`,
      sig: selectionTarget.kind + ':' + selectionTarget.ids.join(','),
      disabled: false,
    }
  }, [selectionTarget, diagram])

  const onName = useCallback((value: string) => {
    if (!selectionTarget) return
    if (selectionTarget.kind === 'forms' && selectionTarget.ids.length === 1) {
      const form = diagram.forms.find((f) => f.id === selectionTarget.ids[0])
      if (form?.kind === 'empty') {
        const midId = pointIdsAt(form, geometryFor(form.kind).edgeKeys[0])[0]
        if (midId) renamePoints([midId], value)
        return // no point yet -> the field is disabled, nothing to do
      }
    }
    if (selectionTarget.kind === 'points') renamePoints(selectionTarget.ids, value)
    else if (selectionTarget.kind === 'forms') renameForms(selectionTarget.ids, value)
    else renameLines(selectionTarget.ids, value)
  }, [selectionTarget, diagram, renamePoints, renameForms, renameLines])

  // ── Color rail: same target as the Name field (points > forms > lines).
  // `colorInfo.isShared` tells the rail (and the top-pill icon) whether the
  // whole target agrees on one color (incl. all-uncolored) — that's the
  // active swatch; a mixed selection has none. ──────────────────────────
  const colorInfo = useMemo(() => {
    if (!selectionTarget) return { shared: undefined as Color | undefined, isShared: false }
    const colors = selectionTarget.ids.map((id) =>
      selectionTarget.kind === 'points' ? diagram.points[id]?.color
        : selectionTarget.kind === 'forms' ? diagram.forms.find((f) => f.id === id)?.color
          : diagram.lines.find((l) => l.id === id)?.color,
    )
    const first = colors[0]
    return { shared: first, isShared: colors.every((c) => sameColor(c, first)) }
  }, [selectionTarget, diagram])

  // Mirrors onPickShape: point(s) selected → color just them; otherwise the
  // click sets the ACTIVE color (the creation default) and also recolors any
  // selected form(s)/line(s).
  const onColor = useCallback((color: Color | null) => {
    if (selectionTarget?.kind === 'points') {
      useStore.getState().setPointsColor(selectionTarget.ids, color)
      return
    }
    setActiveColor(color)
    if (selectionTarget?.kind === 'forms') useStore.getState().setFormsColor(selectionTarget.ids, color)
    else if (selectionTarget?.kind === 'lines') useStore.getState().setLinesColor(selectionTarget.ids, color)
  }, [selectionTarget])

  // ── Rotation field target: selected FORM(s) only (points/lines have no
  // body to rotate) ───────────────────────────────────────────────────
  const selectedFormIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes])
  const rotationInfo = useMemo(() => {
    if (selectedFormIds.length === 0) return { value: 0, sig: '' }
    const form = diagram.forms.find((f) => f.id === selectedFormIds[0])
    return { value: form?.rotation ?? 0, sig: selectedFormIds.join(',') }
  }, [selectedFormIds, diagram])

  const onRotate = useCallback((deg: number) => {
    if (selectedFormIds.length) useStore.getState().setFormsRotation(selectedFormIds, deg)
  }, [selectedFormIds])

  // ── Scale field target: selected FORM(s) only, same shape as rotation's ──
  const scaleInfo = useMemo(() => {
    if (selectedFormIds.length === 0) return { value: 100, sig: '' }
    const form = diagram.forms.find((f) => f.id === selectedFormIds[0])
    return { value: Math.round((form?.scale ?? 1) * 100), sig: selectedFormIds.join(',') }
  }, [selectedFormIds, diagram])

  const onScale = useCallback((pct: number) => {
    if (selectedFormIds.length) useStore.getState().setFormsScale(selectedFormIds, pct / 100)
  }, [selectedFormIds])

  // ── Create forms ───────────────────────────────────────────────────
  // `center` is the intended CENTER of the new form (the click/drop point),
  // not its top-left — callers no longer hand-offset by a hardcoded half
  // size, since that half size differs per kind (BASE_SIZE/2 = 100 for
  // triangle/square/circle/rhombus, but 50 for empty, 11 for point; see
  // forms.ts's nodeSize). A fresh form has no edges/points yet, so nodeSize
  // reads exactly the kind's own default — same SizableForm shape grid.ts's
  // snapCenterPosition expects.
  const createForm = useCallback(
    (kind: FormKind, center: { x: number; y: number }) => {
      setActiveKind(kind)
      const freshForm = { kind, scale: undefined, edges: {}, corners: {} }
      const n = geometryFor(kind).nodeSize(freshForm as Form)
      const topLeft = { x: center.x - n / 2, y: center.y - n / 2 }
      // Grid ON: snapCenterPosition re-derives the center from `topLeft` (as
      // topLeft + n/2, i.e. our original `center`) and snaps THAT — so
      // feeding it our own about-to-be-used top-left snaps the true center,
      // not the top-left corner, while reusing the one snap definition
      // instead of duplicating it here.
      const position = gridEnabled ? snapCenterPosition(freshForm, topLeft) : topLeft
      useStore.getState().addForm(kind, position, activeColor)
    },
    [activeColor, gridEnabled],
  )

  // Click a Shape-rail tile. The SAME rail picks both point shapes and form
  // shapes, applied to the current selection:
  //   • point(s) selected → set their shape (any of the 9);
  //   • else form(s) selected (and the tile is a form kind) → transform them;
  //   • else just set the active form tool (used by double-click / drag-create).
  const onPickShape = useCallback(
    (entry: { kind?: FormKind; pshape: PointShape }) => {
      const pts = useStore.getState().selectedPoints
      if (pts.length > 0) {
        useStore.getState().setPointsShape(pts, entry.pshape)
        return
      }
      if (!entry.kind) return
      setActiveKind(entry.kind)
      const ids = getNodes().filter((n) => n.selected).map((n) => n.id)
      if (ids.length > 0) useStore.getState().setFormsKind(ids, entry.kind)
    },
    [getNodes],
  )

  // Drag a Shape-rail tile onto the canvas → create a form at the drop point.
  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }, [])
  const onDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      const kind = e.dataTransfer.getData('application/form-kind') as FormKind
      if (!kind) return
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      createForm(kind, flow) // flow IS the intended center; createForm derives top-left per-kind
    },
    [screenToFlowPosition, createForm],
  )

  const lastPaneClickRef = useRef(0)
  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      clearSelection()
      const now = Date.now()
      if (now - lastPaneClickRef.current < 350) {
        const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        createForm(activeKind, flow) // flow IS the intended center; createForm derives top-left per-kind
        lastPaneClickRef.current = 0
        return
      }
      lastPaneClickRef.current = now
    },
    [screenToFlowPosition, clearSelection, createForm, activeKind],
  )

  // Selecting form(s) clears any selected point (the other half of exclusivity).
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    if (sel.length === 0) return
    useStore.getState().clearSelection() // a form got selected → drop point selection
    // reflect the selected form's shape in the active tool (and so the top pill)
    if (sel.length === 1) {
      const form = useStore.getState().diagram.forms.find((f) => f.id === sel[0].id)
      if (form) setActiveKind(form.kind)
    }
  }, [])

  // ── Lines: drag handle → handle. A phantom handle (the point-creation
  // ring's hover-only placeholder) is "valid" sight unseen — it always
  // resolves to a real point on connect, so the drag renders normally
  // instead of the invalid/red state React Flow shows for a rejected target.
  const isValidConnection = useCallback((c: Connection | Edge) => {
    const { source, target, sourceHandle, targetHandle } = c
    if (!source || !target || !sourceHandle || !targetHandle) return false
    if (source === target && sourceHandle === targetHandle) return false
    const d = useStore.getState().diagram
    const sourceOk = !!decodePhantomHandle(sourceHandle) || !!handleToPointId(d, source, sourceHandle)
    const targetOk = !!decodePhantomHandle(targetHandle) || !!handleToPointId(d, target, targetHandle)
    return sourceOk && targetOk
  }, [])

  // Where the CURRENT connection drag started — stashed by onConnectStart so
  // resolvePointForHandle's phantom branch can turn "which side of the ring
  // the drag was pulled from" into an insertion index, for the "from" side
  // only (see resolvePointForHandle's own comment on why not the "to" side).
  const connectStartRef = useRef<{ clientX: number; clientY: number } | null>(null)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onConnectStart = useCallback((event: MouseEvent | TouchEvent, _params: any) => {
    const { clientX, clientY } = 'changedTouches' in event ? (event as TouchEvent).changedTouches[0] : (event as MouseEvent)
    connectStartRef.current = { clientX, clientY }
  }, [])

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return
    const src = resolvePointForHandle(params.source, params.sourceHandle, connectStartRef.current, screenToFlowPosition, getNodes)
    const tgt = resolvePointForHandle(params.target, params.targetHandle, null, screenToFlowPosition, getNodes)
    if (!src || !tgt || src === tgt) return
    const existing = useStore.getState().diagram.lines.find((l) => l.source === src)
    if (existing) useStore.getState().addLineTarget(existing.id, tgt)
    else useStore.getState().addLine(src, tgt)
  }, [screenToFlowPosition, getNodes])

  // ── Drag from a point (or phantom) handle onto a form body → attach to
  // nearest edge ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: any) => {
    if (connectionState.isValid || !connectionState.fromNode || !connectionState.fromHandle?.id) return
    const fromPointId = resolvePointForHandle(connectionState.fromNode.id, connectionState.fromHandle.id, connectStartRef.current, screenToFlowPosition, getNodes)
    if (!fromPointId) return
    const d = useStore.getState().diagram
    const { clientX, clientY } = 'changedTouches' in event ? (event as TouchEvent).changedTouches[0] : (event as MouseEvent)
    const newPtId = resolveDropPoint(clientX, clientY, connectionState.fromNode.id, screenToFlowPosition, getNodes)
    if (!newPtId) return
    const srcLine = d.lines.find((l) => l.source === fromPointId)
    if (srcLine && connectionState.fromHandle.type === 'source') useStore.getState().addLineTarget(srcLine.id, newPtId)
    else useStore.getState().addLine(fromPointId, newPtId)
  }, [screenToFlowPosition, getNodes])

  // Shared by the double-click-to-add-point handler and the hover tracker: a
  // node-local point → normalized [0,1]² fraction PLUS the raw local pixel
  // position, rotation-aware. The fraction is UNCLAMPED — a position
  // above/left of the shape must stay negative and a position below/right
  // must stay >1, or isInsideBody can't tell "genuinely outside" from
  // "exactly on the boundary" (ray-casting's boundary convention treats the
  // two differently for opposite edges). Callers that need a valid-edge
  // lookup (edgeAt) clamp the fraction explicitly at the call site.
  const formLocalPoint = useCallback((event: { clientX: number; clientY: number }, node: Node, form: Form) => {
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    return nodeLocalFraction(flow.x, flow.y, node, form)
  }, [screenToFlowPosition])

  // Selecting a form only works from its center zone — root-cause fix for
  // what used to be a select→revert flicker on double-click: the point-
  // creation ring is exclusively the ring's territory (point creation / line
  // pulling), so a click landing there is reverted HERE, synchronously
  // within the SAME click that caused it (React 18 batches React Flow's own
  // click-to-select update and this revert into one commit — no visible
  // frame in between). This naturally covers every case: a plain click on
  // the ring, both clicks of a double-click, and a no-op center-zone
  // double-click — none of them were ever going to select the form anyway.
  const onNodeClick = useCallback((event: React.MouseEvent, node: Node) => {
    const d = useStore.getState().diagram
    const form = d.forms.find((f) => f.id === node.id)
    if (!form) return
    const geom = geometryFor(form.kind)
    const { rx, ry } = formLocalPoint(event, node, form)
    if (!geom.hasCenterZone || isInCenterZone(geom.body, rx, ry)) return
    setNodes((nds) => (nds.some((n) => n.selected) ? nds.map((n) => (n.selected ? { ...n, selected: false } : n)) : nds))
  }, [formLocalPoint, setNodes])

  // ── Add a point: double-click a form near the edge you want. The center
  // zone (if this kind has one) is reserved for whole-form selection, so a
  // double-click there is a no-op rather than sprouting a random edge point.
  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    const d = useStore.getState().diagram
    const form = d.forms.find((f) => f.id === node.id)
    if (!form) return
    const geom = geometryFor(form.kind)
    const { rx, ry } = formLocalPoint(event, node, form)
    if (geom.hasCenterZone && isInCenterZone(geom.body, rx, ry)) return
    const edgeKey = geom.edgeAt(clamp01(rx), clamp01(ry))
    if (!edgeKey) return
    const index = insertionIndex(form, edgeKey, clamp01(rx), clamp01(ry))
    useStore.getState().addPoint(node.id, edgeKey, undefined, index)
  }, [formLocalPoint])

  // ── Cursor territory inside a form, quiver-style — resolved centrally
  // (only Canvas has the full diagram, so only it can check point proximity)
  // in strict priority order: an existing point's own drag handle always
  // wins, regardless of inside/outside the body; then the inner "select the
  // whole form" zone; then the point-creation ring near the edges/corners;
  // then nothing. Tracked in the store so FormNode renders exactly one
  // highlight — never a region and a point (or two regions) at once. ───────
  const onNodeMouseMove = useCallback((event: React.MouseEvent, node: Node) => {
    if (node.type !== 'form') return
    const d = useStore.getState().diagram
    const form = d.forms.find((f) => f.id === node.id)
    if (!form) return
    const geom = geometryFor(form.kind)

    // A point's name label extends outward by a variable amount (its own
    // rendered text width) — no fixed proximity radius around the anchor can
    // reliably reach it, so check the real DOM target directly: it's exactly
    // as reliable as the label's own actual hitbox, whatever its size.
    const labelPointId = (event.target as HTMLElement).closest?.('[data-point-id]')?.getAttribute('data-point-id')
    if (labelPointId) {
      useStore.getState().setHover({ kind: 'point', pointId: labelPointId })
      return
    }

    const { rx, ry, lx, ly, n } = formLocalPoint(event, node, form)

    const nearPoint = nearestPointWithin(form, geom, lx, ly, n)
    if (nearPoint) {
      useStore.getState().setHover({ kind: 'point', pointId: nearPoint })
      return
    }
    if (!isInsideBody(geom.body, rx, ry)) {
      useStore.getState().clearHover()
      return
    }
    if (geom.hasCenterZone && isInCenterZone(geom.body, rx, ry)) {
      useStore.getState().setHover({ kind: 'center', formId: node.id })
      return
    }
    const edgeKey = geom.edgeAt(clamp01(rx), clamp01(ry))
    if (!edgeKey) {
      useStore.getState().clearHover()
      return
    }
    useStore.getState().setHover({ kind: 'edge', formId: node.id, edgeKey, rx: clamp01(rx), ry: clamp01(ry) })
  }, [formLocalPoint])
  const onNodeMouseLeave = useCallback(() => {
    useStore.getState().clearHover()
  }, [])

  // Wire hover — tracked in the store (not CSS :hover) so LineEdge can tint
  // its band AND its portalled label in sync (see store.hoveredEdgeId).
  const onEdgeMouseEnter = useCallback((_: React.MouseEvent, edge: Edge) => {
    useStore.getState().setHoveredEdgeId(edge.id)
  }, [])
  const onEdgeMouseLeave = useCallback(() => {
    useStore.getState().setHoveredEdgeId(null)
  }, [])

  // ── Move ───────────────────────────────────────────────────────────
  // Grid ON: re-snap at persistence time too — live-drag snapping already
  // keeps the visible position grid-aligned (see onNodesChangeSnapped
  // above), but this is what guarantees the STORED position is the snapped
  // one, not just whatever the live-drag path happened to leave it at.
  const onNodeDragStop = useCallback((_: unknown, node: Node, draggedNodes?: Node[]) => {
    const all = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node]
    const d = useStore.getState().diagram
    useStore.getState().moveForms(all.map((n) => {
      const form = d.forms.find((f) => f.id === n.id)
      const position = gridEnabled && form ? snapCenterPosition(form, n.position) : { x: n.position.x, y: n.position.y }
      return { id: n.id, position }
    }))
  }, [gridEnabled])

  // ── Delete ─────────────────────────────────────────────────────────
  const onNodesDelete = useCallback((deleted: Node[]) => {
    deleted.forEach((n) => useStore.getState().deleteForm(n.id))
  }, [])

  const onEdgesDelete = useCallback((deleted: Edge[]) => {
    deleted.forEach((e) => {
      const hash = e.id.lastIndexOf('#')
      if (hash < 0) { useStore.getState().deleteLine(e.id); return }
      const lineId = e.id.slice(0, hash)
      const idx = parseInt(e.id.slice(hash + 1), 10)
      if (Number.isNaN(idx)) useStore.getState().deleteLine(lineId)
      else useStore.getState().deleteLineTarget(lineId, idx)
    })
  }, [])

  // ── Keyboard: undo/redo + delete selected points ──────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        if (typing) return
        e.preventDefault()
        if (e.shiftKey) useStore.getState().redo()
        else useStore.getState().undo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typing) return
        const pts = useStore.getState().selectedPoints
        if (pts.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        for (const id of pts) useStore.getState().removePoint(id)
        useStore.getState().clearSelection()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])

  return (
    <div className={pointsVisible ? undefined : 'points-hidden'} style={{ width: '100%', height: '100%', position: 'relative' }} onDrop={onDrop} onDragOver={onDragOver}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChangeSnapped}
        onEdgesChange={onEdgesChange}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onConnectStart={onConnectStart}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        // React Flow's click-to-connect (on by default) completes a
        // connection from two successive handle CLICKS — with the phantom
        // handles covering every ring band, clicking two side zones silently
        // drew a line between them. Lines are created by DRAGGING, only.
        connectOnClick={false}
        // Plain click = single-select; Cmd/Ctrl+click accumulates; Shift+drag
        // box-selects (selectionKeyCode stays the default Shift). Dragging a
        // form moves it WITHOUT selecting it — selection is a click's job.
        multiSelectionKeyCode={['Meta', 'Control']}
        selectNodesOnDrag={false}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onNodeDoubleClick={onNodeDoubleClick}
        onNodeMouseMove={onNodeMouseMove}
        onNodeMouseLeave={onNodeMouseLeave}
        onEdgeMouseEnter={onEdgeMouseEnter}
        onEdgeMouseLeave={onEdgeMouseLeave}
        onSelectionChange={onSelectionChange}
        onPaneClick={onPaneClick}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Delete', 'Backspace']}
        panOnScroll
        zoomOnPinch
        minZoom={0.05}
        maxZoom={4}
        proOptions={{ hideAttribution: true }}
        style={{ background: theme.canvas.background }}
      >
        {/* Grid ON: quiver-style grid lines at the same GRID_SIZE pitch
            snapping uses — purely visual, React Flow's Background component
            doesn't itself constrain node placement (that's the snapping
            logic above). */}
        {gridEnabled && (
          <Background variant={BackgroundVariant.Lines} gap={GRID_SIZE} color={theme.canvas.gridColor} />
        )}
      </ReactFlow>

      <ToolbarSprite />

      {/* Top-right pill cluster: [grid + points-visibility] [import/export]
          [topRight — the auth/share pill], in that left-to-right order (the
          cluster itself is right-anchored; import/export sits immediately
          LEFT of the share pill, mirroring quiver's round-trip idiom). */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
        <div className="pill-cluster">
          <div className="pill editor-pill">
            <button
              className={`btn btn-icon${gridEnabled ? ' is-active' : ''}`}
              title={gridEnabled ? 'Hide grid & disable snapping' : 'Show grid & snap to grid'}
              aria-label={gridEnabled ? 'Hide grid & disable snapping' : 'Show grid & snap to grid'}
              onClick={toggleGridEnabled}
            >
              <svg aria-hidden="true"><use href="#ic-grid" /></svg>
            </button>
            <button
              className={`btn btn-icon${pointsVisible ? '' : ' is-active'}`}
              title={pointsVisible ? 'Hide point names' : 'Show point names'}
              aria-label={pointsVisible ? 'Hide point names' : 'Show point names'}
              onClick={togglePointsVisible}
            >
              <svg aria-hidden="true"><use href={`#${pointsVisible ? 'ic-eye' : 'ic-eye-off'}`} /></svg>
            </button>
          </div>
          {/* Round trip: Import (paste a share link OR TikZ this editor
              exported, opens a paste panel) on the left, Export (a Copy
              URL / Copy TikZ code dropdown — minimalist, no code preview)
              on the right — one pill, mirrored icons. */}
          {/* position:relative lives HERE (the whole pill), not on ExportMenu's
              own inner wrapper — the dropdown's `right: 0` needs to align with
              the PILL's right edge, not just the Export button's slightly-
              inset flex-item box, or it reads as sitting too far left. */}
          <div className="pill editor-pill" style={{ position: 'relative' }}>
            <button
              className="btn btn-icon"
              title="Import from link or TikZ"
              aria-label="Import from link or TikZ"
              onClick={() => setImportOpen(true)}
            >
              <svg aria-hidden="true"><use href="#ic-import" /></svg>
            </button>
            <ExportMenu diagram={diagram} />
          </div>
          {topRight}
        </div>
      </div>

      {importOpen && <ImportPanel onClose={() => setImportOpen(false)} />}

      {/* General toolbar — the mockup's category Spine (DS .pill, scaled up),
          centred over the canvas. Most categories are placeholders; clicking
          "Shape" opens the forms toolbar directly below it. */}
      <div style={{ position: 'absolute', top: 16, left: 'calc(50% + (var(--sidebar-offset, 0px) / 2))', transform: 'translateX(-50%)', zIndex: 10, transition: 'left 200ms' }}>
        <div className="pill editor-pill" role="toolbar" aria-label="Categories">
          {CATEGORIES.map((cat) => (
            <button
              key={cat.key}
              className={`btn btn-icon${cat.key === activeCategory ? ' is-active' : ''}`}
              title={cat.label}
              onClick={() => setActiveCategory((c) => (c === cat.key ? '' : cat.key))}
            >
              {cat.key === 'shape'
                ? <svg aria-hidden="true"><use href={`#${activeKindSymbol}`} /></svg>
                : cat.key === 'color'
                  ? <span style={swatchStyle(selectionTarget ? (colorInfo.isShared ? colorInfo.shared : undefined) : activeColor, cat.key === activeCategory, 16)} />
                  : cat.content}
            </button>
          ))}
        </div>
      </div>

      {/* Second toolbar — the Shape rail. Only triangle/circle/square work. */}
      {activeCategory === 'shape' && (
        <div style={{ position: 'absolute', top: 70, left: 'calc(50% + (var(--sidebar-offset, 0px) / 2))', transform: 'translateX(-50%)', zIndex: 10, transition: 'left 200ms' }}>
          <div className="pill editor-pill" role="group" aria-label="Shape">
            {SHAPE_RAIL.map((s) => {
              const active = selectedPoints.length > 0 ? s.pshape === selectedPointShape : s.kind === activeKind
              return (
                <button
                  key={s.label}
                  className={`btn btn-icon${active ? ' is-active' : ''}`}
                  title={selectedPoints.length > 0
                    ? `${s.label} point`
                    : s.kind ? `${s.label} — apply to selected form, or drag onto canvas to create` : s.label}
                  draggable={!!s.kind}
                  onDragStart={(e) => {
                    if (!s.kind) { e.preventDefault(); return }
                    e.dataTransfer.setData('application/form-kind', s.kind)
                    e.dataTransfer.effectAllowed = 'copy'
                  }}
                  onClick={() => onPickShape(s)}
                >
                  <svg aria-hidden="true"><use href={`#${s.symbol}`} /></svg>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Second toolbar — the Color rail. Same target as the Name field
          (points > forms > lines); White resets to the default. Sizes to
          content, like the Shape rail. */}
      {activeCategory === 'color' && (
        <div style={{ position: 'absolute', top: 70, left: 'calc(50% + (var(--sidebar-offset, 0px) / 2))', transform: 'translateX(-50%)', zIndex: 10, transition: 'left 200ms' }}>
          <div className="pill editor-pill" role="group" aria-label="Color">
            {COLOR_RAIL.map((c) => {
              // With a selection, the rail reflects its shared color; without
              // one it reflects the active (creation-default) color — same
              // split as the Shape rail's selectedPointShape/activeKind.
              const active = selectionTarget
                ? colorInfo.isShared && sameColor(colorInfo.shared, c.color)
                : sameColor(activeColor, c.color)
              return (
                <button
                  key={c.label}
                  className={`btn btn-icon${active ? ' is-active' : ''}`}
                  title={c.label}
                  onClick={() => onColor(c.color)}
                >
                  <span style={swatchStyle(c.color, active, 16)} />
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Name field — the whole pill is a text input renaming the current
          selection (points > forms > lines). Same width as the Shape rail. */}
      {activeCategory === 'name' && (
        <div style={{ position: 'absolute', top: 70, left: 'calc(50% + (var(--sidebar-offset, 0px) / 2))', transform: 'translateX(-50%)', zIndex: 10, transition: 'left 200ms' }}>
          <div className="pill editor-pill" style={{ width: 360, padding: '0 4px' }}>
            <NameField sig={nameInfo.sig} initial={nameInfo.value} placeholder={nameInfo.placeholder} disabled={!selectionTarget || nameInfo.disabled} onChange={onName} />
          </div>
        </div>
      )}

      {/* Rotation field — a 0-359° slider over the selected form(s). Same
          width as the Shape rail. */}
      {activeCategory === 'rotation' && (
        <div style={{ position: 'absolute', top: 70, left: 'calc(50% + (var(--sidebar-offset, 0px) / 2))', transform: 'translateX(-50%)', zIndex: 10, transition: 'left 200ms' }}>
          <div className="pill editor-pill" style={{ width: 360, padding: '0 4px' }}>
            <RotationField sig={rotationInfo.sig} initial={rotationInfo.value} disabled={selectedFormIds.length === 0} onChange={onRotate} />
          </div>
        </div>
      )}

      {/* Scale field — a 25-400% slider over the selected form(s). Same
          width/position as the Rotation pill. */}
      {activeCategory === 'scale' && (
        <div style={{ position: 'absolute', top: 70, left: 'calc(50% + (var(--sidebar-offset, 0px) / 2))', transform: 'translateX(-50%)', zIndex: 10, transition: 'left 200ms' }}>
          <div className="pill editor-pill" style={{ width: 360, padding: '0 4px' }}>
            <ScaleField sig={scaleInfo.sig} initial={scaleInfo.value} disabled={selectedFormIds.length === 0} onChange={onScale} />
          </div>
        </div>
      )}
    </div>
  )
}

interface CanvasProps {
  diagramId: string | null
  initialData: Diagram
  topRight?: ReactNode
  localDraft?: boolean
}

export default function CanvasRoot({ diagramId, initialData, topRight, localDraft }: CanvasProps) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    initStore(initialData)
    setReady(true)
  }, [initialData])
  useAutosave(ready ? diagramId : null)
  useLocalAutosave(ready && !!localDraft)
  if (!ready) return null
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlowProvider>
        <Canvas topRight={topRight} />
      </ReactFlowProvider>
    </div>
  )
}
