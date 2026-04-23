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
  type Node,
  type Edge,
  type Connection,
  type NodeTypes,
  type EdgeTypes,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import DiagramNode from './DiagramNode'
import DiagramEdge from './DiagramEdge'
import { useStore, initStore } from './store'
import { useAutosave } from './save'
import type { DiagramData, DiagramPoint } from './types'
import theme, { panelStyle, glassBlur } from './style/theme'

const nodeTypes: NodeTypes = { node: DiagramNode }
const edgeTypes: EdgeTypes = { editable: DiagramEdge }

type NodeSide = 'left' | 'right' | 'center' | 'down' | 'up' | 'total'
type Slot = 'down' | 'center' | 'up'

// Parse handle ID: "left-0" → {side,index}, "left-down-0" → {side,slot,index}, "center-0" → {side:'center',index}
// Rectangle edges: "up-0", "down-0" (stackable).
function parseHandle(handleId: string): { side: NodeSide; slot?: Slot; index: number } {
  const parts = handleId.split('-')
  if (parts.length === 3) return { side: parts[0] as 'left' | 'right', slot: parts[1] as Slot, index: parseInt(parts[2]) }
  return { side: parts[0] as NodeSide, index: parseInt(parts[1]) }
}

// Build handle ID from DiagramPoint fields
function handleIdFromPt(pt: DiagramPoint): string {
  if (pt.slot) return `${pt.side}-${pt.slot}-${pt.index}`
  return `${pt.side}-${pt.index}`
}

// Unified point lookup by handle ID (works for all shapes including rhombus, triangle, rectangle, empty)
function lookupPtByHandle(diagram: DiagramData, nodeName: string, handleId: string): DiagramPoint | undefined {
  const { side, slot, index } = parseHandle(handleId)
  if (side === 'total') {
    const tri = diagram.triangles.find((t) => t.id === nodeName); if (tri) return tri.points.total
    const rect = diagram.rectangles.find((r) => r.id === nodeName); if (rect) return rect.points.total
    const circle = diagram.circles.find((c) => c.id === nodeName); if (circle) return circle.points.total
    const rhombus = diagram.rhombuses.find((r) => r.id === nodeName); if (rhombus) return rhombus.points.total
    return undefined
  }
  if (side === 'center') {
    // Triangle: single-point legacy — no slot.
    const tri = diagram.triangles.find((t) => t.id === nodeName); if (tri) return tri.points.center
    // Rectangle/circle/rhombus: 3-slot column. Handle id carries the slot.
    const sl: Slot = slot ?? 'center'
    const rect = diagram.rectangles.find((r) => r.id === nodeName); if (rect) return rect.points.center[sl]
    const circle = diagram.circles.find((c) => c.id === nodeName); if (circle) return circle.points.center[sl]
    const rhombus = diagram.rhombuses.find((r) => r.id === nodeName); if (rhombus) return rhombus.points.center[sl]
    return undefined
  }
  const rect = diagram.rectangles.find((r) => r.id === nodeName)
  if (rect) {
    if (side === 'down' || side === 'up') return rect.points[side][index]
    const s = rect.points[side]
    if (slot === 'down') return s.down
    if (slot === 'up') return s.up
    return s.center[index]
  }
  const rhombus = diagram.rhombuses.find((r) => r.id === nodeName)
  if (rhombus) {
    if (side === 'left' || side === 'right') {
      const s = rhombus.points[side]
      if (slot === 'center') return s.center
      if (slot === 'down') return s.down[index]
      if (slot === 'up') return s.up[index]
      return undefined
    }
    if (side === 'up') return rhombus.points.up
    if (side === 'down') return rhombus.points.down
  }
  const tri = diagram.triangles.find((t) => t.id === nodeName)
  if (tri) {
    if (side === 'left') return tri.points.left[index]
    if (side === 'right') return tri.points.right[index]
    return undefined
  }
  const circle = diagram.circles.find((c) => c.id === nodeName)
  if (circle && (side === 'left' || side === 'right' || side === 'up' || side === 'down')) {
    return circle.points[side][index]
  }
  const empty = diagram.empties.find((e) => e.id === nodeName)
  if (empty && (side === 'left' || side === 'right')) return empty.points[side]
  return undefined
}

function Canvas() {
  const diagram = useStore((s) => s.diagram)
  const visibility = useStore((s) => s.visibility)
  const toggleVisibility = useStore((s) => s.toggleVisibility)
  const edgePath = useStore((s) => s.edgePath)
  const toggleEdgePath = useStore((s) => s.toggleEdgePath)
  const addNode = useStore((s) => s.addNode)
  const addEmpty = useStore((s) => s.addEmpty)
  const deleteNode = useStore((s) => s.deleteNode)
  const renameNode = useStore((s) => s.renameNode)
  const addPoint = useStore((s) => s.addPoint)
  const setPointLabel = useStore((s) => s.setPointLabel)
  const removePointOnNode = useStore((s) => s.removePointOnNode)
  const attachPoint = useStore((s) => s.attachPoint)
  const addLine = useStore((s) => s.addLine)
  const addLineTarget = useStore((s) => s.addLineTarget)
  const addLineWithFreeEnd = useStore((s) => s.addLineWithFreeEnd)
  const deleteLine = useStore((s) => s.deleteLine)
  const deleteLineTarget = useStore((s) => s.deleteLineTarget)
  const renameLine = useStore((s) => s.renameLine)
  const setSelectedPoints = useStore((s) => s.setSelectedPoints)
  const lastPaneClickRef = useRef(0)
  const spaceHeldRef = useRef(false)
  const { screenToFlowPosition, getNodes } = useReactFlow()

  const [kindsOpen, setKindsOpen] = useState(false)
  const [jsonOpen, setJsonOpen] = useState(false)
  const importDiagram = useStore((s) => s.importDiagram)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const diagramJSON = useMemo(
    () => jsonOpen ? JSON.stringify(diagram, null, 2) : '',
    [jsonOpen, diagram]
  )

  function diagramText() {
    return JSON.stringify(useStore.getState().diagram, null, 2)
  }

  function downloadJSON(text: string) {
    const blob = new Blob([text], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'diagram.json'
    a.click()
    URL.revokeObjectURL(url)
  }

  function exportJSON() {
    downloadJSON(diagramText())
  }

  function importJSON(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        importDiagram(JSON.parse(reader.result as string) as DiagramData)
      } catch (err) {
        alert('Invalid JSON: ' + (err as Error).message)
      }
    }
    reader.readAsText(file)
  }

  // ===== Build nodes from abstract diagram =====
  const builtNodes: Node[] = useMemo(() => {
    const emptyNodes = diagram.empties.map((e) => ({
      id: e.id,
      type: 'node',
      hidden: !visibility.empties,
      position: e.position,
      data: {
        kind: 'empty' as const,
        label: '',
        accent: theme.node.accentBlue,
        points: {
          left: e.points.left ? [e.points.left] : [],
          right: e.points.right ? [e.points.right] : [],
        },
        onAddPoint: (side: 'left' | 'right') => addPoint(e.id, side),
        onSetPointLabel: (nodeName: string, side: 'left' | 'right', index: number, label: string) =>
          setPointLabel(nodeName, side, index, label),
        onRename: (newName: string) => renameNode('empty', e.id, newName),
      },
    }))

    const triNodes = diagram.triangles.map((t) => ({
      id: t.id,
      type: 'node',
      hidden: !visibility.triangles,
      position: t.position,
      data: {
        kind: 'triangle' as const,
        label: t.id,
        accent: theme.node.accentBlue,
        points: { left: t.points.left, right: t.points.right },
        centerPoint: t.points.center,
        totalPoint: t.points.total,
        onAddPoint: (side: NodeSide) => addPoint(t.id, side),
        onSetPointLabel: (nodeName: string, side: NodeSide, index: number, label: string) => setPointLabel(nodeName, side, index, label),
        onRename: (newName: string) => renameNode('triangle', t.id, newName),
      },
    }))

    const rectNodes = diagram.rectangles.map((r) => ({
      id: r.id,
      type: 'node',
      hidden: !visibility.rectangles,
      position: r.position,
      data: {
        kind: 'rectangle' as const,
        label: r.id,
        accent: theme.node.accentBlue,
        points: { left: [] as DiagramPoint[], right: [] as DiagramPoint[] },
        rectanglePoints: r.points,
        centerColumn: r.points.center,
        totalPoint: r.points.total,
        onAddPoint: (side: NodeSide, slot?: Slot) => addPoint(r.id, side, undefined, slot),
        onSetPointLabel: (nodeName: string, side: NodeSide, index: number, label: string, slot?: Slot) =>
          setPointLabel(nodeName, side, index, label, slot),
        onRename: (newName: string) => renameNode('rectangle', r.id, newName),
      },
    }))

    const circleNodes = diagram.circles.map((c) => ({
      id: c.id,
      type: 'node',
      hidden: !visibility.circles,
      position: c.position,
      data: {
        kind: 'circle' as const,
        label: c.id,
        accent: theme.node.accentBlue,
        points: { left: c.points.left, right: c.points.right, up: c.points.up, down: c.points.down },
        centerColumn: c.points.center,
        totalPoint: c.points.total,
        onAddPoint: (side: NodeSide, slot?: Slot) => addPoint(c.id, side, undefined, slot),
        onSetPointLabel: (nodeName: string, side: NodeSide, index: number, label: string, slot?: Slot) =>
          setPointLabel(nodeName, side, index, label, slot),
        onRename: (newName: string) => renameNode('circle', c.id, newName),
      },
    }))

    const rhombusNodes = diagram.rhombuses.map((r) => ({
      id: r.id,
      type: 'node',
      hidden: !visibility.rhombuses,
      position: r.position,
      data: {
        kind: 'rhombus' as const,
        label: r.id,
        accent: theme.node.accentBlue,
        points: { left: [] as DiagramPoint[], right: [] as DiagramPoint[] },
        rhombusPoints: r.points,
        centerColumn: r.points.center,
        totalPoint: r.points.total,
        onAddPoint: (side: NodeSide, slot?: Slot) => addPoint(r.id, side, undefined, slot),
        onSetPointLabel: (nodeName: string, side: NodeSide, index: number, label: string, slot?: Slot) =>
          setPointLabel(nodeName, side, index, label, slot),
        onRename: (newName: string) => renameNode('rhombus', r.id, newName),
      },
    }))

    return [...emptyNodes, ...triNodes, ...rectNodes, ...circleNodes, ...rhombusNodes]
  }, [diagram, visibility.rectangles, visibility.triangles, visibility.circles, visibility.rhombuses, visibility.empties, addPoint, setPointLabel, renameNode])

  // Build edges from lines. One DiagramLine → N xyflow edges (one per target branch).
  const derivedEdges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (const line of diagram.lines) {
      const sp = line.points.source
      line.points.targets.forEach((tp, i) => {
        out.push({
          id: `${line.id}#${i}`,
          source: sp.node!,
          sourceHandle: handleIdFromPt(sp),
          target: tp.node!,
          targetHandle: handleIdFromPt(tp),
          type: 'editable',
          animated: true,
          hidden: !visibility.lines,
          data: {
            label: line.id,
            onRename: (newName: string) => renameLine(line.id, newName),
          },
        })
      })
    }
    // Label anti-overlap: group edges by the DIRECTED (source,target) pair
    // (bidirectional pairs stay in separate groups — otherwise symmetric
    // offsets push labels the same way in world space and merge instead of
    // separating).
    //
    // Only nudge when the widest label in a group is wide enough to hard-
    // overlap at the midpoint. Short labels (≲ NUDGE_THRESHOLD_PX) keep their
    // natural midpoint. Wide ones get a GENTLE centered spread around 0.5
    // (step 0.1 per index) so labels stay near the line center instead of
    // being pushed toward the endpoints:
    //   N=2 → 0.45 / 0.55    N=3 → 0.40 / 0.50 / 0.60
    //   N=4 → 0.35 / 0.45 / 0.55 / 0.65
    // Deterministic order (by edge id) keeps assignment stable across renders.
    const CHAR_W = 7              // approximate char width for the label font
    const LABEL_PADDING = 16      // left+right padding in the label background
    const NUDGE_THRESHOLD_PX = 100
    const STEP = 0.1              // fractional distance between neighboring labels
    const groups = new Map<string, Edge[]>()
    for (const e of out) {
      const key = `${e.source}|${e.target}`
      const list = groups.get(key) ?? []
      list.push(e)
      groups.set(key, list)
    }
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const maxLabelWidth = Math.max(...group.map((e) => {
        const label = (e.data as { label?: string })?.label ?? ''
        return label.length * CHAR_W + LABEL_PADDING
      }))
      if (maxLabelWidth < NUDGE_THRESHOLD_PX) continue
      group.sort((a, b) => a.id.localeCompare(b.id))
      const mid = (group.length - 1) / 2
      group.forEach((e, i) => {
        const fraction = 0.5 + (i - mid) * STEP
        e.data = { ...(e.data ?? {}), labelFraction: fraction }
      })
    }
    return out
  }, [diagram, visibility.lines, renameLine])

  // ===== ReactFlow state =====
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])

  useEffect(() => {
    setNodes((prev) => {
      const prevById = new Map(prev.map((n) => [n.id, n]))
      return builtNodes.map((bn) => {
        const existing = prevById.get(bn.id)
        if (!existing) return bn
        // During a drag, keep React Flow's local position. Otherwise (including
        // undo/redo and drag-commit) take the position from the store.
        const position = existing.dragging ? existing.position : bn.position
        return { ...bn, position, selected: existing.selected, dragging: existing.dragging }
      })
    })
  }, [builtNodes, setNodes])

  useEffect(() => {
    setEdges((prev) => {
      const prevById = new Map(prev.map((e) => [e.id, e]))
      return derivedEdges.map((de) => {
        const existing = prevById.get(de.id)
        if (!existing) return de
        return { ...de, selected: existing.selected }
      })
    })
  }, [derivedEdges, setEdges])

  // ===== Interactions =====
  const isValidConnection = useCallback(
    (connection: Connection | Edge) => {
      const { source, target, sourceHandle, targetHandle } = connection
      if (!source || !target || !sourceHandle || !targetHandle) return false
      if (source === target) return false
      const d = useStore.getState().diagram
      const srcName = lookupPtByHandle(d, source, sourceHandle)?.name
      const tgtName = lookupPtByHandle(d, target, targetHandle)?.name
      if (srcName === undefined || tgtName === undefined) return false
      if (srcName === '' || tgtName === '') return true
      return srcName === tgtName
    },
    []
  )

  const onConnect = useCallback(
    (params: Connection) => {
      if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return
      if (params.source === params.target) return
      const d = useStore.getState().diagram
      const src = parseHandle(params.sourceHandle)
      const tgt = parseHandle(params.targetHandle)
      const srcPt = lookupPtByHandle(d, params.source, params.sourceHandle)
      const tgtPt = lookupPtByHandle(d, params.target, params.targetHandle)
      if (!srcPt?.name || !tgtPt?.name) return
      const source: DiagramPoint = { name: srcPt.name, node: params.source, side: src.side, index: src.index, ...(src.slot ? { slot: src.slot } : {}) }
      const target: DiagramPoint = { name: tgtPt.name, node: params.target, side: tgt.side, index: tgt.index, ...(tgt.slot ? { slot: tgt.slot } : {}) }
      // Branch if this source handle already has a line; else create a new line.
      const existing = d.lines.find((l) => l.points.source.node === source.node && l.points.source.side === source.side && l.points.source.index === source.index && l.points.source.slot === source.slot)
      if (existing) addLineTarget(existing.id, target)
      else addLine(source, target)
    },
    [addLine, addLineTarget]
  )

  // When user drags from a handle and drops on empty space or a node body
  const onConnectEnd = useCallback(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (event: MouseEvent | TouchEvent, connectionState: any) => {
      if (connectionState.isValid || !connectionState.fromNode || !connectionState.fromHandle?.id) return

      const handleId = connectionState.fromHandle.id as string
      const parsed = parseHandle(handleId)
      const nodeName = connectionState.fromNode.id as string
      const d = useStore.getState().diagram
      const attachedPt = lookupPtByHandle(d, nodeName, handleId)
      if (!attachedPt?.name) return
      const attached: DiagramPoint = { name: attachedPt.name, node: nodeName, side: parsed.side, index: parsed.index, ...(parsed.slot ? { slot: parsed.slot } : {}) }
      const fromType = connectionState.fromHandle.type as string

      const { clientX, clientY } = 'changedTouches' in event ? (event as TouchEvent).changedTouches[0] : (event as MouseEvent)
      const position = screenToFlowPosition({ x: clientX, y: clientY })

      // Detect if dropped on a node — uses the 2× selection outline as the hit area,
      // so drops in the visible frame around the body still register on the node.
      const dropTarget = getNodes().find((n) => {
        if (n.id === nodeName || n.type !== 'node') return false
        const w = n.measured?.width ?? n.width ?? 0
        const h = n.measured?.height ?? n.height ?? 0
        const padX = w / 2
        const padY = h / 2
        return (
          position.x >= n.position.x - padX &&
          position.x <= n.position.x + w + padX &&
          position.y >= n.position.y - padY &&
          position.y <= n.position.y + h + padY
        )
      })

      // If the drag originated from a SOURCE handle that already has a line, we branch that line.
      const existingLine = fromType === 'source'
        ? d.lines.find((l) => l.points.source.node === attached.node && l.points.source.side === attached.side && l.points.source.index === attached.index && l.points.source.slot === attached.slot)
        : undefined

      if (dropTarget) {
        const isRhombus = d.rhombuses.some((r) => r.id === dropTarget.id)
        const isRectangle = d.rectangles.some((r) => r.id === dropTarget.id)
        const isCircle = d.circles.some((c) => c.id === dropTarget.id)
        const isTriangle = d.triangles.some((t) => t.id === dropTarget.id)

        const w = dropTarget.measured?.width ?? dropTarget.width ?? 1
        const h = dropTarget.measured?.height ?? dropTarget.height ?? 1
        const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
        const rx = clamp01((position.x - dropTarget.position.x) / w)
        const ry = clamp01((position.y - dropTarget.position.y) / h)

        // All four sides are always candidates — handles are bipolar, so flow
        // direction comes from the drag (source→drop), not the side's role.
        // up/down are only present on shapes that support them.
        type EdgeSide = 'left' | 'right' | 'up' | 'down'
        const hasUpDown = isRectangle || isRhombus || isCircle
        const candidates: Array<{ side: EdgeSide; dist: number }> = [
          { side: 'left',  dist: rx },
          { side: 'right', dist: 1 - rx },
          ...(hasUpDown ? [
            { side: 'up'   as EdgeSide, dist: ry },
            { side: 'down' as EdgeSide, dist: 1 - ry },
          ] : []),
        ]
        // Triangle-specific: only left/right sides carry point arrays.
        const filtered = isTriangle
          ? candidates.filter((c) => c.side === 'left' || c.side === 'right')
          : candidates
        filtered.sort((a, b) => a.dist - b.dist)
        const dropSide: EdgeSide = filtered[0].side

        // Rhombus: pick up/down slot from the drop y-position.
        // Rectangle: left/right drops must be anchored to the 'center' slot so the
        // stored point's slot matches the rendered handle id (left-center-i).
        const dropSlot: 'up' | 'down' | 'center' | undefined =
          isRhombus && (dropSide === 'left' || dropSide === 'right')
            ? (ry < 0.5 ? 'up' : 'down')
            : isRectangle && (dropSide === 'left' || dropSide === 'right')
              ? 'center'
              : undefined

        const newIndex = addPoint(dropTarget.id, dropSide, attachedPt.name, dropSlot)
        const newPoint: DiagramPoint = {
          name: attachedPt.name, node: dropTarget.id,
          side: dropSide, index: newIndex,
          ...(dropSlot ? { slot: dropSlot } : {}),
        }
        if (existingLine) {
          addLineTarget(existingLine.id, newPoint)
        } else {
          // Flow = drag direction. The drag starts at `attached` and ends at the
          // new point, so attached is the source and newPoint the target.
          addLine(attached, newPoint)
        }
        return
      }

      // Dropped on empty space → create empty carrier; either extend existing line or new line.
      if (existingLine) {
        const emptyName = addEmpty(position, 'left', attachedPt.name)
        const target: DiagramPoint = { name: attachedPt.name, node: emptyName, side: 'left', index: 0 }
        addLineTarget(existingLine.id, target)
      } else {
        const freeRole: 'source' | 'target' = fromType === 'target' ? 'source' : 'target'
        addLineWithFreeEnd(attached, freeRole, position)
      }
    },
    [screenToFlowPosition, getNodes, addLine, addLineTarget, addLineWithFreeEnd, addEmpty, addPoint]
  )

  const onNodeDragStop = useCallback((_: unknown, node: Node, draggedNodes?: Node[]) => {
    // React Flow passes every node that moved during this drag (multi-select
    // drags move them all together). Commit all positions as one history entry.
    const all = draggedNodes && draggedNodes.length > 0 ? draggedNodes : [node]
    useStore.getState().updateNodePositions(all.map((n) => ({ id: n.id, position: n.position })))

    // Drag-to-attach only applies to a single empty being dropped on a shape.
    // Multi-node drags skip auto-attach.
    if (all.length > 1) return
    const kind = (node.data as { kind?: string })?.kind
    if (kind !== 'empty') return

    const SNAP_DIST = 15
    const nodeCenter = {
      x: node.position.x + (node.measured?.width ?? 0) / 2,
      y: node.position.y + (node.measured?.height ?? 0) / 2,
    }

    const target = getNodes().find((n) => {
      if (n.id === node.id || n.type !== 'node') return false
      const w = n.measured?.width ?? n.width ?? 0
      const h = n.measured?.height ?? n.height ?? 0
      const dx = Math.max(n.position.x - nodeCenter.x, 0, nodeCenter.x - (n.position.x + w))
      const dy = Math.max(n.position.y - nodeCenter.y, 0, nodeCenter.y - (n.position.y + h))
      return Math.sqrt(dx * dx + dy * dy) <= SNAP_DIST
    })

    if (!target) return

    const d = useStore.getState().diagram
    const empty = d.empties.find((e) => e.id === node.id)
    if (!empty) return
    // Only auto-attach single-point carriers (rename-empties with both sides are skipped)
    const hasLeft = !!empty.points.left
    const hasRight = !!empty.points.right
    if (hasLeft === hasRight) return

    // Collect references to this empty across all lines (as source or as any target).
    type Ref = { line: typeof d.lines[number]; end: { kind: 'source' } | { kind: 'target'; index: number } }
    const refs: Ref[] = []
    for (const l of d.lines) {
      if (l.points.source.node === empty.id) refs.push({ line: l, end: { kind: 'source' } })
      l.points.targets.forEach((t, i) => { if (t.node === empty.id) refs.push({ line: l, end: { kind: 'target', index: i } }) })
    }
    if (refs.length !== 1) return
    const { line, end } = refs[0]

    const isRhombus = d.rhombuses.some((r) => r.id === target.id)
    const isRectangle = d.rectangles.some((r) => r.id === target.id)
    const isCircle = d.circles.some((c) => c.id === target.id)
    const isTriangle = d.triangles.some((t) => t.id === target.id)

    // Any side is reachable — handles are bipolar.
    const w = target.measured?.width ?? target.width ?? 1
    const h = target.measured?.height ?? target.height ?? 1
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v))
    const rx = clamp01((nodeCenter.x - target.position.x) / w)
    const ry = clamp01((nodeCenter.y - target.position.y) / h)
    type EdgeSide = 'left' | 'right' | 'up' | 'down'
    const hasUpDown = isRectangle || isRhombus || isCircle
    const allCandidates: Array<{ side: EdgeSide; dist: number }> = [
      { side: 'left',  dist: rx },
      { side: 'right', dist: 1 - rx },
      ...(hasUpDown ? [
        { side: 'up'   as EdgeSide, dist: ry },
        { side: 'down' as EdgeSide, dist: 1 - ry },
      ] : []),
    ]
    const candidates = isTriangle
      ? allCandidates.filter((c) => c.side === 'left' || c.side === 'right')
      : allCandidates
    candidates.sort((a, b) => a.dist - b.dist)
    const dropSide = candidates[0].side

    const attachSlot: 'up' | 'down' | 'center' | undefined =
      isRhombus && (dropSide === 'left' || dropSide === 'right')
        ? (ry < 0.5 ? 'up' : 'down')
        : isRectangle && (dropSide === 'left' || dropSide === 'right')
          ? 'center'
          : undefined

    attachPoint(line.id, end, target.id, dropSide, attachSlot)
  }, [getNodes, attachPoint])

  const clearSelectedPoints = useCallback(() => {
    if (useStore.getState().selectedPoints.length > 0) setSelectedPoints([], true)
  }, [setSelectedPoints])

  const onNodeClick = useCallback(
    (event: React.MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey)) clearSelectedPoints()
    },
    [clearSelectedPoints]
  )

  const onEdgeClick = useCallback(
    (event: React.MouseEvent) => {
      if (!(event.metaKey || event.ctrlKey)) clearSelectedPoints()
    },
    [clearSelectedPoints]
  )

  const onPaneClick = useCallback(
    (event: React.MouseEvent) => {
      clearSelectedPoints()
      const now = Date.now()
      if (now - lastPaneClickRef.current < 350) {
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY })
        if (event.metaKey || event.ctrlKey) addNode('rectangle', position)
        else if (event.shiftKey)             addNode('rhombus',   position)
        else if (event.altKey)               addNode('triangle',  position)
        else if (spaceHeldRef.current)       addNode('circle',    position)
        else                                  addEmpty(position)
        lastPaneClickRef.current = 0
        return
      }
      lastPaneClickRef.current = now
    },
    [screenToFlowPosition, addNode, addEmpty, clearSelectedPoints]
  )

  useEffect(() => {
    const onDown = (e: KeyboardEvent) => {
      if (e.code !== 'Space') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      spaceHeldRef.current = true
    }
    const onUp = (e: KeyboardEvent) => { if (e.code === 'Space') spaceHeldRef.current = false }
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    return () => { window.removeEventListener('keydown', onDown); window.removeEventListener('keyup', onUp) }
  }, [])

  // Undo/redo
  useEffect(() => {
    const onUndoRedo = (e: KeyboardEvent) => {
      if (e.key !== 'z' || !(e.metaKey || e.ctrlKey)) return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      e.preventDefault()
      if (e.shiftKey) {
        useStore.getState().redo()
      } else {
        useStore.getState().undo()
      }
    }
    window.addEventListener('keydown', onUndoRedo)
    return () => window.removeEventListener('keydown', onUndoRedo)
  }, [])

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) return
      const pts = useStore.getState().selectedPoints
      if (pts.length === 0) return
      e.preventDefault()
      e.stopPropagation()
      for (const s of pts) {
        // container format: "${nodeId}|${handleId}" — single uniform pipeline.
        const pipe = s.container.indexOf('|')
        if (pipe < 0) continue
        const nodeName = s.container.slice(0, pipe)
        const { side, slot, index } = parseHandle(s.container.slice(pipe + 1))
        removePointOnNode(nodeName, side, index, slot)
      }
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [removePointOnNode])

  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      deleted.forEach((n) => {
        const kind = (n.data as { kind?: string })?.kind
        if (kind === 'empty') {
          deleteNode('empty', n.id)
        } else if (diagram.triangles.some((t) => t.id === n.id)) {
          deleteNode('triangle', n.id)
        } else if (diagram.circles.some((c) => c.id === n.id)) {
          deleteNode('circle', n.id)
        } else if (diagram.rhombuses.some((r) => r.id === n.id)) {
          deleteNode('rhombus', n.id)
        } else {
          deleteNode('rectangle', n.id)
        }
      })
    },
    [diagram, deleteNode]
  )

  const onEdgesDelete = useCallback(
    (deleted: Edge[]) => {
      deleted.forEach((e) => {
        const hash = e.id.lastIndexOf('#')
        if (hash < 0) { deleteLine(e.id); return }
        const lineName = e.id.slice(0, hash)
        const idx = parseInt(e.id.slice(hash + 1))
        if (Number.isNaN(idx)) deleteLine(lineName)
        else deleteLineTarget(lineName, idx)
      })
    },
    [deleteLine, deleteLineTarget]
  )


  return (
    <>
      <ReactFlow
        className={visibility.points ? undefined : 'points-hidden'}
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onEdgesDelete={onEdgesDelete}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        isValidConnection={isValidConnection}
        onNodeDragStop={onNodeDragStop}
        onNodeClick={onNodeClick}
        onEdgeClick={onEdgeClick}
        onPaneClick={onPaneClick}
        onNodesDelete={onNodesDelete}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        deleteKeyCode={['Delete', 'Backspace']}
        panOnScroll
        zoomOnPinch
        proOptions={{ hideAttribution: true }}
        style={{ background: theme.canvas.background }}
      >
        <Controls />
        <Background variant={BackgroundVariant.Dots} color={theme.canvas.gridColor} gap={20} size={1} />
      </ReactFlow>

      {/* Kinds + edge-path toggle (top left) — slides with sidebar via --sidebar-offset */}
      <div style={{ position: 'absolute', top: 12, left: 'calc(12px + var(--sidebar-offset, 0px))', zIndex: 10, display: 'flex', gap: 8, alignItems: 'flex-start', transition: 'left 200ms' }}>
        <div style={{ position: 'relative' }} onMouseEnter={() => setKindsOpen(true)} onMouseLeave={() => setKindsOpen(false)}>
          <button style={{ ...panelStyle(), borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, color: theme.text.secondary, cursor: 'pointer', fontFamily: 'inherit' }}>
            Kinds
          </button>
          {kindsOpen && (
            <div style={{ position: 'absolute', top: '100%', left: 0, paddingTop: 6 }}>
              <div style={{ ...panelStyle(), borderRadius: 8, padding: '6px 6px', minWidth: 220 }}>
                <KindRow label="Empties" on={visibility.empties} onToggle={() => toggleVisibility('empties')} shortcut={['2×']} />
                <KindRow label="Points" on={visibility.points} onToggle={() => toggleVisibility('points')} shortcut={['click +']} />
                <KindRow label="Lines" on={visibility.lines} onToggle={() => toggleVisibility('lines')} shortcut={['drag ○→○']} />
                <KindRow label="Triangles" on={visibility.triangles} onToggle={() => toggleVisibility('triangles')} shortcut={['Alt/⌥', '2×']} />
                <KindRow label="Rhombuses" on={visibility.rhombuses} onToggle={() => toggleVisibility('rhombuses')} shortcut={['⇧', '2×']} />
                <KindRow label="Circles" on={visibility.circles} onToggle={() => toggleVisibility('circles')} shortcut={['␣', '2×']} />
                <KindRow label="Rectangles" on={visibility.rectangles} onToggle={() => toggleVisibility('rectangles')} shortcut={['Ctrl/⌘', '2×']} />
              </div>
            </div>
          )}
        </div>
        <button
          onClick={toggleEdgePath}
          title={`Edge path: ${edgePath === 'straight' ? 'straight' : 'smooth step'} — click to switch`}
          style={{ ...panelStyle(), borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, color: theme.text.secondary, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          {edgePath === 'straight' ? 'Straight' : 'Smooth'}
        </button>
      </div>

      {/* JSON button (top right) */}
      <div style={{ position: 'absolute', top: 12, right: 12, zIndex: 10, display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-end' }}>
        <button
          onClick={() => setJsonOpen(!jsonOpen)}
          style={{ ...panelStyle(), borderRadius: 8, padding: '6px 14px', fontSize: 12, fontWeight: 600, color: theme.text.secondary, cursor: 'pointer', fontFamily: 'inherit' }}
        >
          JSON
        </button>
        {jsonOpen && (
          <div style={{ ...panelStyle(), borderRadius: 8, width: 400, maxHeight: 500, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 12px', borderBottom: `1px solid ${theme.glass.borderColor}` }}>
              <span style={{ fontSize: 11, fontWeight: 600, color: theme.text.muted, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Diagram Data
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button onClick={exportJSON} style={{ ...glassBlur(), background: theme.glass.buttonBg, border: `1px solid ${theme.glass.borderColor}`, borderRadius: 4, color: theme.text.secondary, fontSize: 11, padding: '2px 10px', cursor: 'pointer' }}>
                  Export
                </button>
                <button onClick={() => fileInputRef.current?.click()} style={{ ...glassBlur(), background: theme.glass.buttonBg, border: `1px solid ${theme.glass.borderColor}`, borderRadius: 4, color: theme.text.secondary, fontSize: 11, padding: '2px 10px', cursor: 'pointer' }}>
                  Import
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="application/json,.json"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    const f = e.target.files?.[0]
                    if (f) importJSON(f)
                    e.target.value = ''
                  }}
                />
              </div>
            </div>
            <pre style={{ background: 'rgba(0,0,0,0.25)', margin: 0, padding: 12, fontSize: 10, color: theme.text.muted, overflow: 'auto', lineHeight: 1.4, fontFamily: "'SF Mono', Menlo, monospace", flex: 1 }}>
              {diagramJSON}
            </pre>
          </div>
        )}
      </div>
    </>
  )
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
      minWidth: 18, height: 18, padding: '0 5px',
      border: `1px solid ${theme.glass.borderColor}`, borderRadius: 4,
      background: 'rgba(255,255,255,0.05)', color: theme.text.secondary,
      fontFamily: 'var(--font-mono), ui-monospace, SFMono-Regular, Menlo, monospace',
      fontSize: 10, fontWeight: 500, lineHeight: 1, letterSpacing: 0,
      whiteSpace: 'nowrap',
    }}>{children}</kbd>
  )
}

function KindRow({ label, on, onToggle, shortcut }: { label: string; on: boolean; onToggle: () => void; shortcut?: string[] }) {
  return (
    <div
      onClick={onToggle}
      style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '5px 10px', cursor: 'pointer',
        color: on ? theme.text.secondary : theme.text.dimmed, fontSize: 11, fontWeight: 500,
        userSelect: 'none', borderRadius: 4, transition: 'color 0.12s, background 0.12s',
      }}
      onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'rgba(255,255,255,0.04)' }}
      onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.background = 'transparent' }}
    >
      <div style={{
        width: 6, height: 6, borderRadius: '50%',
        background: on ? `rgba(${theme.node.accentBlue}, 0.9)` : 'transparent',
        border: on ? 'none' : '1px solid rgba(255,255,255,0.22)',
        boxShadow: on ? `0 0 0 3px rgba(${theme.node.accentBlue}, 0.2)` : 'none',
        transition: 'all 0.12s ease', flexShrink: 0, marginLeft: 2,
      }} />
      <span>{label}</span>
      {shortcut && shortcut.length > 0 && (
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 3 }}>
          {shortcut.map((t, i) => <Kbd key={i}>{t}</Kbd>)}
        </span>
      )}
    </div>
  )
}

interface CanvasProps {
  diagramId: string | null
  initialData: DiagramData
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
