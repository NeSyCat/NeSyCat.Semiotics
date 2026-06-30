'use client'

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  BackgroundVariant,
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
import { useAutosave } from './save'
import { geometryFor } from './forms'
import { encodeHandle, decodeHandle } from './handles'
import theme from './theme'
import type { Diagram, FormKind } from './types'

const nodeTypes: NodeTypes = { form: FormNode }
const edgeTypes: EdgeTypes = { line: LineEdge }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// point id -> { nodeId, handleId } (the form it sits on + its handle).
function pointToHandle(d: Diagram, pointId: string): { nodeId: string; handleId: string } | undefined {
  const pt = d.points[pointId]
  if (!pt) return undefined
  const form = d.forms.find((f) => f.id === pt.formId)
  if (!form) return undefined
  const idx = (form.edges[pt.edgeKey] ?? []).indexOf(pointId)
  if (idx < 0) return undefined
  return { nodeId: form.id, handleId: encodeHandle(pt.edgeKey, idx) }
}

// (nodeId, handleId) -> point id.
function handleToPointId(d: Diagram, nodeId: string, handleId: string): string | undefined {
  const form = d.forms.find((f) => f.id === nodeId)
  if (!form) return undefined
  const { edgeKey, index } = decodeHandle(handleId)
  return (form.edges[edgeKey] ?? [])[index]
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
        <symbol id="kind-empty" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2.6" />
        </symbol>
        <symbol id="kind-point" viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.15" fill="currentColor" /></symbol>
        <symbol id="kind-line" viewBox="0 0 24 24"><path d="M2.75 12L21.25 12" fill="none" stroke="currentColor" strokeLinecap="round" /></symbol>
        <symbol id="kind-triangle" viewBox="0 0 24 24"><path d="M12 2.75L20.011 16.625L3.989 16.625Z" /></symbol>
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
  { key: 'name', label: 'Name', content: <span style={{ fontWeight: 600, fontSize: 14 }}>X</span> },
]

// Second toolbar — the Shape rail. SAME 9 slots as the Spine (equal length);
// only triangle/circle/square create a form for now (the rest are placeholders).
const SHAPE_RAIL: Array<{ label: string; symbol: string; kind?: FormKind }> = [
  { label: 'Empty', symbol: 'kind-empty' },
  { label: 'Point', symbol: 'kind-point' },
  { label: 'Line', symbol: 'kind-line' },
  { label: 'Triangle', symbol: 'kind-triangle', kind: 'triangle' },
  { label: 'Rhombus', symbol: 'kind-rhombus' },
  { label: 'Pentagon', symbol: 'kind-pentagon' },
  { label: 'Hexagon', symbol: 'kind-hexagon' },
  { label: 'Circle', symbol: 'kind-circle', kind: 'circle' },
  { label: 'Square', symbol: 'kind-rectangle', kind: 'square' },
]

function Canvas() {
  const diagram = useStore((s) => s.diagram)
  const clearSelection = useStore((s) => s.clearSelection)
  const renameLine = useStore((s) => s.renameLine)
  const { screenToFlowPosition, getNodes } = useReactFlow()

  const [activeKind, setActiveKind] = useState<FormKind>('triangle')
  const [activeCategory, setActiveCategory] = useState<string>('shape')

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
          data: { label: line.name ?? line.id, onRename: (name: string) => renameLine(line.id, name) },
        })
      })
    }
    return out
  }, [diagram, renameLine])

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

  // ── Create forms ───────────────────────────────────────────────────
  const createForm = useCallback(
    (kind: FormKind, flow: { x: number; y: number }) => {
      setActiveKind(kind)
      useStore.getState().addForm(kind, flow)
    },
    [],
  )

  // Click a Shape-rail tile: make it the active kind, and TRANSFORM any selected
  // forms to it. With nothing selected, this only sets the tool — no form is
  // created (creation happens via double-click pane or drag-drop).
  const onPickShape = useCallback(
    (kind: FormKind) => {
      setActiveKind(kind)
      const ids = getNodes().filter((n) => n.selected).map((n) => n.id)
      if (ids.length > 0) useStore.getState().setFormsKind(ids, kind)
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
    if (!dropTarget) return
    const targetForm = d.forms.find((f) => f.id === dropTarget.id)
    if (!targetForm) return
    const geom = geometryFor(targetForm.kind)
    const w = dropTarget.measured?.width ?? dropTarget.width ?? 1
    const h = dropTarget.measured?.height ?? dropTarget.height ?? 1
    const rx = clamp01((position.x - dropTarget.position.x) / w)
    const ry = clamp01((position.y - dropTarget.position.y) / h)
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
    const rx = clamp01((flow.x - node.position.x) / w)
    const ry = clamp01((flow.y - node.position.y) / h)
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
    <div style={{ width: '100%', height: '100%', position: 'relative' }} onDrop={onDrop} onDragOver={onDragOver}>
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
        onNodeDragStop={onNodeDragStop}
        onNodeDoubleClick={onNodeDoubleClick}
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
        <Background variant={BackgroundVariant.Dots} color={theme.canvas.gridColor} gap={20} size={1} />
      </ReactFlow>

      <ToolbarSprite />

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
              {cat.content}
            </button>
          ))}
        </div>
      </div>

      {/* Second toolbar — the Shape rail. SAME 9 slots as the Spine, so both
          pills are always the same length. Only triangle/circle/square work. */}
      {activeCategory === 'shape' && (
        <div style={{ position: 'absolute', top: 70, left: 'calc(50% + (var(--sidebar-offset, 0px) / 2))', transform: 'translateX(-50%)', zIndex: 10, transition: 'left 200ms' }}>
          <div className="pill editor-pill" role="group" aria-label="Shape">
            {SHAPE_RAIL.map((s) => (
              <button
                key={s.label}
                className={`btn btn-icon${s.kind && s.kind === activeKind ? ' is-active' : ''}`}
                title={s.kind ? `${s.label} — click to apply to selection, drag onto canvas to create` : s.label}
                draggable={!!s.kind}
                onDragStart={(e) => {
                  if (!s.kind) { e.preventDefault(); return }
                  e.dataTransfer.setData('application/form-kind', s.kind)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => s.kind && onPickShape(s.kind)}
              >
                <svg aria-hidden="true"><use href={`#${s.symbol}`} /></svg>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

interface CanvasProps {
  diagramId: string | null
  initialData: Diagram
}

export default function CanvasRoot({ diagramId, initialData }: CanvasProps) {
  const [ready, setReady] = useState(false)
  useLayoutEffect(() => {
    initStore(initialData)
    setReady(true)
  }, [initialData])
  useAutosave(ready ? diagramId : null)
  if (!ready) return null
  return (
    <div style={{ width: '100%', height: '100%', position: 'relative' }}>
      <ReactFlowProvider>
        <Canvas />
      </ReactFlowProvider>
    </div>
  )
}
