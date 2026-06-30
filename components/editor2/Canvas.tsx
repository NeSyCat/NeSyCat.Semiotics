'use client'

import { useState, useMemo, useCallback, useRef, useEffect, useLayoutEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  BackgroundVariant,
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
import theme, { panelStyle } from './theme'
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

function Canvas() {
  const diagram = useStore((s) => s.diagram)
  const edgePath = useStore((s) => s.edgePath)
  const toggleEdgePath = useStore((s) => s.toggleEdgePath)
  const clearSelection = useStore((s) => s.clearSelection)
  const renameLine = useStore((s) => s.renameLine)
  const { screenToFlowPosition, getNodes } = useReactFlow()

  const [activeKind, setActiveKind] = useState<FormKind>('triangle')

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

  const createAtCenter = useCallback(
    (kind: FormKind) => {
      const flow = screenToFlowPosition({ x: window.innerWidth / 2, y: window.innerHeight / 2 })
      // nudge so successive creates don't perfectly overlap
      const jitter = useStore.getState().diagram.forms.length * 24
      createForm(kind, { x: flow.x - 100 + jitter, y: flow.y - 100 + jitter })
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
    <>
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
        <Controls />
        <Background variant={BackgroundVariant.Dots} color={theme.canvas.gridColor} gap={20} size={1} />
      </ReactFlow>

      {/* Create toolbar (top-left). Click to drop a form; double-click the pane
          creates the last-picked kind at the cursor. */}
      <div style={{ position: 'absolute', top: 12, left: 'calc(12px + var(--sidebar-offset, 0px))', zIndex: 10, display: 'flex', gap: 8, transition: 'left 200ms' }}>
        {(['triangle', 'square', 'circle'] as FormKind[]).map((kind) => (
          <button
            key={kind}
            onClick={() => createAtCenter(kind)}
            title={`Add ${kind}`}
            style={{
              ...panelStyle(), borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600,
              color: kind === activeKind ? `rgb(${theme.node.accentBlue})` : theme.text.secondary,
              cursor: 'pointer', fontFamily: 'inherit', textTransform: 'capitalize',
            }}
          >
            {kind}
          </button>
        ))}
        <button
          onClick={toggleEdgePath}
          title={`Edge path: ${edgePath} — click to switch`}
          style={{ ...panelStyle(), borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, color: theme.text.secondary, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {edgePath === 'straight' ? 'Straight' : 'Smooth'}
        </button>
      </div>
    </>
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
