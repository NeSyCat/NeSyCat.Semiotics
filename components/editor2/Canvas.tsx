'use client'

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect, type ReactNode } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  ConnectionMode,
  useNodesState,
  useEdgesState,
  useReactFlow,
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import FormNode from './FormNode'
import LineEdge from './LineEdge'
import { useStore, initStore } from './store'
import { useAutosave, useLocalAutosave } from './save'
import { geometryFor, pointIdsAt, BASE_SIZE } from './forms'
import { encodeHandle, decodeHandle } from './handles'
import theme from './theme'
import type { Diagram, FormKind, PointShape } from './types'

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
          <path d="M9 4H4v5M15 20h5v-5M4 4l6 6M20 20l-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
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

// Top Spine pill — the mockup's 9 categories (exact symbols / value glyphs).
// Only "shape" opens a working second toolbar; the rest are placeholders.
const CATEGORIES: Array<{ key: string; label: string; content: React.ReactNode }> = [
  { key: 'direction', label: 'Direction', content: <svg aria-hidden="true"><use href="#ic-direction-center" /></svg> },
  { key: 'weight', label: 'Weight', content: <svg aria-hidden="true"><use href="#ic-weight" /></svg> },
  { key: 'scale', label: 'Scale', content: <svg aria-hidden="true"><use href="#ic-scale" /></svg> },
  { key: 'rotation', label: 'Rotation', content: <svg aria-hidden="true"><use href="#ic-rotation" /></svg> },
  { key: 'location', label: 'Location', content: <svg aria-hidden="true"><use href="#ic-location" /></svg> },
  { key: 'order', label: 'Order', content: <span style={{ fontWeight: 600, fontSize: 14 }}>5</span> },
  { key: 'color', label: 'Color', content: <span style={{ width: 18, height: 18, borderRadius: '50%', background: '#0080ff', display: 'block' }} /> },
  { key: 'shape', label: 'Shape', content: <svg aria-hidden="true"><use href="#kind-hexagon" /></svg> },
  { key: 'name', label: 'Name', content: <span style={{ fontWeight: 600, fontSize: 14, fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}>Aa</span> },
]

// Second toolbar — the Shape rail. SAME 9 slots as the Spine (equal length).
// Every tile sets the shape of the SELECTED POINT(S). For FORMS, only tiles
// with a `kind` are functional; the rest are point-only placeholders (but all
// 9 are valid point shapes).
const SHAPE_RAIL: Array<{ label: string; symbol: string; pshape: PointShape; kind?: FormKind }> = [
  { label: 'Empty', symbol: 'kind-empty', pshape: 'empty', kind: 'empty' },
  { label: 'Point', symbol: 'kind-point', pshape: 'point', kind: 'point' },
  { label: 'Line', symbol: 'kind-line', pshape: 'line' },
  { label: 'Triangle', symbol: 'kind-triangle', pshape: 'triangle', kind: 'triangle' },
  { label: 'Rhombus', symbol: 'kind-rhombus', pshape: 'rhombus', kind: 'rhombus' },
  { label: 'Pentagon', symbol: 'kind-pentagon', pshape: 'pentagon' },
  { label: 'Hexagon', symbol: 'kind-hexagon', pshape: 'hexagon' },
  { label: 'Circle', symbol: 'kind-circle', pshape: 'circle', kind: 'circle' },
  { label: 'Square', symbol: 'kind-rectangle', pshape: 'square', kind: 'square' },
]

// Which toolbar tool/category is active is a UI preference, not diagram data —
// persisted to localStorage (not the store/history) so it survives a reload
// without becoming an undo step or part of the saved diagram.
const ACTIVE_KIND_KEY = 'nesycat.editor.activeKind'
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
// landing on an exact 0/90/180/270 is easy without fighting the mouse.
const RIGHT_ANGLES = [0, 90, 180, 270, 360]
const SNAP_TOLERANCE = 12
function snapToRightAngle(v: number): number {
  const hit = RIGHT_ANGLES.find((a) => Math.abs(v - a) <= SNAP_TOLERANCE)
  return hit === undefined ? v : hit % 360
}

// The Rotation category's second pill — a 0-359° slider over the selected
// form(s) (mirrors the mockup's bounds slider), plus a directly-editable
// degree readout. `sig` re-seeds the field when the selection changes, same
// coalescing-drag pattern as NameField.
function RotationField({ sig, initial, disabled, onChange }: {
  sig: string; initial: number; disabled: boolean; onChange: (v: number) => void
}) {
  const [val, setVal] = useState(initial)
  const [text, setText] = useState(String(initial))
  useEffect(() => { setVal(initial); setText(String(initial)) }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (deg: number) => {
    const wrapped = ((Math.round(deg) % 360) + 360) % 360
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
        max={359}
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
  const { screenToFlowPosition, getNodes } = useReactFlow()

  const [activeKind, setActiveKind] = useState<FormKind>(() => {
    const stored = readLocalStorage(ACTIVE_KIND_KEY)
    return stored && SHAPE_RAIL.some((s) => s.kind === stored) ? (stored as FormKind) : 'triangle'
  })
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    const stored = readLocalStorage(ACTIVE_CATEGORY_KEY)
    return stored != null && (stored === '' || CATEGORIES.some((c) => c.key === stored)) ? stored : 'shape'
  })
  useEffect(() => { writeLocalStorage(ACTIVE_KIND_KEY, activeKind) }, [activeKind])
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

  // ── Name field target: the current selection (points > forms > lines) ──
  const nameTarget = useMemo(() => {
    const formIds = nodes.filter((n) => n.selected).map((n) => n.id)
    const lineIds = [...new Set(edges.filter((e) => e.selected).map((e) => String(e.id).split('#')[0]))]
    if (selectedPoints.length) return { kind: 'points' as const, ids: selectedPoints }
    if (formIds.length) return { kind: 'forms' as const, ids: formIds }
    if (lineIds.length) return { kind: 'lines' as const, ids: lineIds }
    return null
  }, [nodes, edges, selectedPoints])

  const nameInfo = useMemo(() => {
    if (!nameTarget) return { value: '', placeholder: 'Select a form, point, or line', sig: '' }
    const id0 = nameTarget.ids[0]
    const single = nameTarget.ids.length === 1
    const name = nameTarget.kind === 'points' ? diagram.points[id0]?.name
      : nameTarget.kind === 'forms' ? diagram.forms.find((f) => f.id === id0)?.name
        : diagram.lines.find((l) => l.id === id0)?.name
    return {
      value: single ? (name ?? '') : '',
      placeholder: single ? id0 : `${nameTarget.ids.length} ${nameTarget.kind}`,
      sig: nameTarget.kind + ':' + nameTarget.ids.join(','),
    }
  }, [nameTarget, diagram])

  const onName = useCallback((value: string) => {
    if (!nameTarget) return
    if (nameTarget.kind === 'points') renamePoints(nameTarget.ids, value)
    else if (nameTarget.kind === 'forms') renameForms(nameTarget.ids, value)
    else renameLines(nameTarget.ids, value)
  }, [nameTarget, renamePoints, renameForms, renameLines])

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

  // ── Create forms ───────────────────────────────────────────────────
  const createForm = useCallback(
    (kind: FormKind, flow: { x: number; y: number }) => {
      setActiveKind(kind)
      useStore.getState().addForm(kind, flow)
    },
    [],
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
      createForm(kind, { x: flow.x - 100, y: flow.y - 100 })
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
        createForm(activeKind, { x: flow.x - 100, y: flow.y - 100 })
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

  // ── Lines: drag handle → handle ────────────────────────────────────
  const isValidConnection = useCallback((c: Connection | Edge) => {
    const { source, target, sourceHandle, targetHandle } = c
    if (!source || !target || !sourceHandle || !targetHandle) return false
    if (source === target && sourceHandle === targetHandle) return false
    const d = useStore.getState().diagram
    return !!handleToPointId(d, source, sourceHandle) && !!handleToPointId(d, target, targetHandle)
  }, [])

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return
    const d = useStore.getState().diagram
    const src = handleToPointId(d, params.source, params.sourceHandle)
    const tgt = handleToPointId(d, params.target, params.targetHandle)
    if (!src || !tgt || src === tgt) return
    const existing = d.lines.find((l) => l.source === src)
    if (existing) useStore.getState().addLineTarget(existing.id, tgt)
    else useStore.getState().addLine(src, tgt)
  }, [])

  // ── Drag from a point handle onto a form body → attach to nearest edge ─
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: any) => {
    if (connectionState.isValid || !connectionState.fromNode || !connectionState.fromHandle?.id) return
    const d = useStore.getState().diagram
    const fromPointId = handleToPointId(d, connectionState.fromNode.id, connectionState.fromHandle.id)
    if (!fromPointId) return
    const { clientX, clientY } = 'changedTouches' in event ? (event as TouchEvent).changedTouches[0] : (event as MouseEvent)
    const position = screenToFlowPosition({ x: clientX, y: clientY })

    const dropTarget = getNodes().find((node) => {
      if (node.id === connectionState.fromNode.id || node.type !== 'form') return false
      const w = node.measured?.width ?? node.width ?? 0
      const h = node.measured?.height ?? node.height ?? 0
      return (
        position.x >= node.position.x && position.x <= node.position.x + w &&
        position.y >= node.position.y && position.y <= node.position.y + h
      )
    })
    if (!dropTarget) {
      // Dropped on empty canvas — spin up an anonymous "empty" carrier form
      // with its own point right there, and wire the dragged connection to
      // it. Lets you draw a wire out into space instead of placing a shape
      // first and connecting to it as a second step.
      const size = BASE_SIZE / 2 // matches emptyGeometry's nodeSize
      const newFormId = useStore.getState().addForm('empty', { x: position.x - size / 2, y: position.y - size / 2 })
      const newPtId = useStore.getState().addPoint(newFormId, 'self')
      if (!newPtId) return
      const srcLine = d.lines.find((l) => l.source === fromPointId)
      if (srcLine && connectionState.fromHandle.type === 'source') useStore.getState().addLineTarget(srcLine.id, newPtId)
      else useStore.getState().addLine(fromPointId, newPtId)
      return
    }
    const targetForm = d.forms.find((f) => f.id === dropTarget.id)
    if (!targetForm) return
    const geom = geometryFor(targetForm.kind)
    const w = dropTarget.measured?.width ?? dropTarget.width ?? 1
    const h = dropTarget.measured?.height ?? dropTarget.height ?? 1
    const [lx, ly] = unrotateLocal(position.x - dropTarget.position.x, position.y - dropTarget.position.y, w, h, targetForm.rotation ?? 0)
    const rx = clamp01(lx / w)
    const ry = clamp01(ly / h)
    const edgeKey = geom.edgeAt(rx, ry)
    if (!edgeKey) return
    const newPtId = useStore.getState().addPoint(dropTarget.id, edgeKey)
    if (!newPtId) return
    const srcLine = d.lines.find((l) => l.source === fromPointId)
    if (srcLine && connectionState.fromHandle.type === 'source') useStore.getState().addLineTarget(srcLine.id, newPtId)
    else useStore.getState().addLine(fromPointId, newPtId)
  }, [screenToFlowPosition, getNodes])

  // ── Add a point: double-click a form near the edge you want ────────
  const onNodeDoubleClick = useCallback((event: React.MouseEvent, node: Node) => {
    const d = useStore.getState().diagram
    const form = d.forms.find((f) => f.id === node.id)
    if (!form) return
    const geom = geometryFor(form.kind)
    const w = node.measured?.width ?? node.width ?? geom.nodeSize(form)
    const h = node.measured?.height ?? node.height ?? geom.nodeSize(form)
    const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const [lx, ly] = unrotateLocal(flow.x - node.position.x, flow.y - node.position.y, w, h, form.rotation ?? 0)
    const rx = clamp01(lx / w)
    const ry = clamp01(ly / h)
    const edgeKey = geom.edgeAt(rx, ry)
    if (!edgeKey) return
    useStore.getState().addPoint(node.id, edgeKey)
  }, [screenToFlowPosition])

  // ── Move ───────────────────────────────────────────────────────────
  const onNodeDragStop = useCallback((_: unknown, node: Node, draggedNodes?: Node[]) => {
    const all = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node]
    useStore.getState().moveForms(all.map((n) => ({ id: n.id, position: { x: n.position.x, y: n.position.y } })))
  }, [])

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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onNodesDelete={onNodesDelete}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        connectionMode={ConnectionMode.Loose}
        // Plain click = single-select; Cmd/Ctrl+click accumulates; Shift+drag
        // box-selects (selectionKeyCode stays the default Shift).
        multiSelectionKeyCode={['Meta', 'Control']}
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
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
      </ReactFlow>

      <ToolbarSprite />

      {/* Points-visibility toggle — a single-button pill in the canvas's top-right
          corner, mirroring the sidebar's collapse pill on the opposite side.
          `topRight` (the auth/share pill) joins it in a pill-cluster. */}
      <div style={{ position: 'absolute', top: 16, right: 16, zIndex: 10 }}>
        <div className="pill-cluster">
          <div className="pill editor-pill">
            <button
              className={`btn btn-icon${pointsVisible ? '' : ' is-active'}`}
              title={pointsVisible ? 'Hide point names' : 'Show point names'}
              aria-label={pointsVisible ? 'Hide point names' : 'Show point names'}
              onClick={togglePointsVisible}
            >
              <svg aria-hidden="true"><use href={`#${pointsVisible ? 'ic-eye' : 'ic-eye-off'}`} /></svg>
            </button>
          </div>
          {topRight}
        </div>
      </div>

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
                : cat.content}
            </button>
          ))}
        </div>
      </div>

      {/* Second toolbar — the Shape rail. SAME 9 slots as the Spine, so both
          pills are always the same length. Only triangle/circle/square work. */}
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

      {/* Name field — the whole pill is a text input renaming the current
          selection (points > forms > lines). Same width as the Shape rail. */}
      {activeCategory === 'name' && (
        <div style={{ position: 'absolute', top: 70, left: 'calc(50% + (var(--sidebar-offset, 0px) / 2))', transform: 'translateX(-50%)', zIndex: 10, transition: 'left 200ms' }}>
          <div className="pill editor-pill" style={{ width: 360, padding: '0 4px' }}>
            <NameField sig={nameInfo.sig} initial={nameInfo.value} placeholder={nameInfo.placeholder} disabled={!nameTarget} onChange={onName} />
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
