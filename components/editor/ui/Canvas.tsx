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
import { useStore, initStore } from '../state/store'
import { useAutosave, useLocalAutosave } from '../persist/save'
import { geometryFor, pointIdsAt, isInsideBody, isInCenterZone, insertionIndex, bodyCentroid, worldPointNormal, BASE_SIZE, CENTER_SHRINK, type FormGeometry } from '../domain/forms'
import type { Dir } from '../domain/wirepath'
import { encodeHandle, decodeHandle, decodePhantomHandle } from '../domain/handles'
import { GRID_SIZE, snapCenterPosition } from '../domain/grid'
import ImportPanel from './ImportPanel'
import ExportPanel from './ExportPanel'
import theme from './theme'
import type { Diagram, Form, Shape, Color } from '../domain/types'
import { ToolbarSprite } from './sprite'
import { CATEGORIES, SHAPE_RAIL, sameColor } from './rails'
import { TopRightPills } from './toolbars/TopRightPills'
import { MainToolbar } from './toolbars/MainToolbar'
import { SecondToolbar } from './toolbars/SecondToolbar'
import { useEditorKeyboard } from './hooks/useEditorKeyboard'

const nodeTypes: NodeTypes = { form: FormNode }
const edgeTypes: EdgeTypes = { line: LineEdge }

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

// The current selection (points > forms > lines), pure priority — shared by
// the Name field, the Color rail, and the toolbar components that render
// them (MainToolbar/SecondToolbar), whose targeting is identical.
export type SelectionTarget = { kind: 'points' | 'forms' | 'lines'; ids: string[] } | null

// A form's CSS rotation is purely visual — its node box/position stay in the
// unrotated flow frame. Edge/corner hit-testing (double-click to add a point,
// drag-drop to auto-attach a line) needs the INVERSE of that rotation applied
// to the click point first, or a click on what's now visually the right side
// resolves against where the right side used to be before rotating.
//
// Pivot is (cx, cy) explicitly, NOT w/2, h/2 — FormNode.tsx's own CSS
// transform-origin (and geometry-ir.ts's export-path layoutForm) rotate
// about the body's bodyCentroid, not its bbox center, since a triangle's
// true centroid sits toward its base. This MUST invert that exact same
// pivot, or a click on what's now visually the right side of a rotated
// triangle resolves against a DIFFERENT point than the one the CSS rotation
// actually put there — hover territory, phantom-handle placement, and
// drop-attach would all target the wrong spot the instant an asymmetric
// shape rotates. Coincides with w/2, h/2 for square/circle/rhombus/empty,
// whose centroid IS their bbox center by construction — unchanged for those.
function unrotateLocal(localX: number, localY: number, cx: number, cy: number, rotationDeg: number): [number, number] {
  if (!rotationDeg) return [localX, localY]
  const theta = (rotationDeg * Math.PI) / 180
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
  const geom = geometryFor(form.shape)
  const n = node.measured?.width ?? node.width ?? geom.nodeSize(form) * (form.scale ?? 1)
  const [ccx, ccy] = bodyCentroid(geom.body)
  const [lx, ly] = unrotateLocal(flowX - node.position.x, flowY - node.position.y, ccx * n, ccy * n, form.rotation ?? 0)
  return { rx: lx / n, ry: ly / n, lx, ly, n }
}

// Radius (local/unrotated px) within which an existing point's own drag
// handle takes priority over the form's region/center hover — see
// nearestPointWithin below. Also the click-to-select catch radius (onNodeClick):
// a body click this close to a point selects it. INVISIBLE (not the drawn disc,
// which stays POINT_SIZE) — just a forgiving hit target so clicks near a point
// land ON it instead of the form.
const POINT_HOVER_RADIUS = 18

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

// A click (no drag) on or beside an EXISTING point resolves to that point
// purely from WHERE the press landed — never from which handle React Flow
// happened to start the gesture on. That handle id is the fragile part (a
// phantom spot handle shadowing a real point, an off-by-one edge index, a
// press RF attributed to a neighbouring handle), but the pointer's LOCATION is
// ground truth. So this is the ONE selection resolver every point kind shares,
// used by both onConnectEnd (dot press → RF connection) and onNodeClick (body
// press near a point). Returns null on an empty spot — nothing to select there;
// point creation stays double-click / drag.
function existingPointAtClient(
  clientX: number, clientY: number, nodeId: string,
  screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number },
  getNodes: () => Node[],
): string | null {
  const node = getNodes().find((nd) => nd.id === nodeId)
  const form = useStore.getState().diagram.forms.find((f) => f.id === nodeId)
  if (!node || !form) return null
  const flow = screenToFlowPosition({ x: clientX, y: clientY })
  const { lx, ly, n } = nodeLocalFraction(flow.x, flow.y, node, form)
  return nearestPointWithin(form, geometryFor(form.shape), lx, ly, n)
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
    // Grid ON: the auto-created empty form's CENTER (= its middle point)
    // snaps to the nearest intersection, same composition createForm uses —
    // so drawing a string out onto blank canvas lands the point exactly on
    // the grid, not wherever the drop happened to end.
    const topLeft = { x: position.x - size / 2, y: position.y - size / 2 }
    const snapped = useStore.getState().gridEnabled
      ? snapCenterPosition({ shape: 'empty', scale: undefined }, topLeft)
      : topLeft
    const newFormId = useStore.getState().addForm('empty', snapped)
    return useStore.getState().addPoint(newFormId, 'self') || null
  }
  const d = useStore.getState().diagram
  const targetForm = d.forms.find((f) => f.id === dropTarget.id)
  if (!targetForm) return null
  const geom = geometryFor(targetForm.shape)
  const { rx, ry } = nodeLocalFraction(position.x, position.y, dropTarget, targetForm)
  const edgeKey = geom.edgeAt(clamp01(rx), clamp01(ry))
  const onSpot = !!edgeKey && geom.regionShape(edgeKey).kind === 'spot'
  // A drop on a spot (corner/centre/apex) attaches there even inside the centre
  // zone; a bare centre-zone drop (a side there) is whole-form-selection
  // territory and is rejected.
  if (!onSpot && geom.hasCenterZone && isInCenterZone(geom.body, rx, ry)) return null
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

// point id -> its TRUE outward wire-tangent (domain/forms.ts's
// worldPointNormal: the form's own per-shape edge/arc perpendicular,
// rotated by the form's own rotation) — null for a free end ('empty'/
// pointIsForm, e.g. a 'self'-edgeKey point; worldPointNormal itself already
// returns null there, no separate check needed). A point's outward normal
// is GEOMETRY (its shape + its form's rotation), not a per-frame drag
// position, so — unlike sourceX/sourceY/targetX/targetY, which LineEdge.tsx
// takes from React Flow's own live per-frame coordinates, NOT from here —
// this document-derived value is fine to only update on diagram mutation.
// builtEdges below is the ONLY caller; ir/geometry-ir.ts's buildLineCmds
// calls the SAME worldPointNormal (off its own already-resolved form/
// edgeKey/index/count), so canvas and exports can never disagree on a
// point's tangent.
function pointWorldNormal(d: Diagram, pointId: string): Dir {
  const pt = d.points[pointId]
  if (!pt) return null
  const form = d.forms.find((f) => f.id === pt.formId)
  if (!form) return null
  const ids = pointIdsAt(form, pt.edgeKey)
  const index = ids.indexOf(pointId)
  if (index < 0) return null
  return worldPointNormal(form, pt.edgeKey, index, ids.length)
}

// '' (an explicitly cleared line name that bypassed store's own renameLine
// safeguard — e.g. a raw JSON import via persist/io.ts's canonLine, which
// does not collapse '' to undefined the way the store does) must render
// NEITHER text NOR mask, same as a blank POINT name (PointVisual's own
// `labelText !== ''` guard) — NOT fall back to the line's id the way a
// genuinely undefined name does. LineEdge.tsx's `d.label != null` check
// already treats undefined as "render nothing"; this is what makes '' do
// the same instead of leaking through as a literal empty-string label
// (which IS != null, and would render an empty masked box on the wire).
function lineLabel(name: string | undefined, id: string): string | undefined {
  return name === '' ? undefined : (name ?? id)
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
// `gesturePoint` is the client (screen) coords used to place a phantom's new
// point among its edge's existing ones: for the "from" side, where the drag
// STARTED (stashed by onConnectStart); for the "to" side, the CURRENT
// pointer position at drop time (tracked via a window 'pointermove' listener
// between onConnectStart/onConnectEnd — see connectPointerRef in Canvas),
// since React Flow's onConnect callback carries no client coords of its own
// for where the drop landed. Passing null/undefined falls back to a plain
// append (used when no gesture position is available at all).
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

// Which toolbar tool/category is active is a UI preference, not diagram data —
// persisted to localStorage (not the store/history) so it survives a reload
// without becoming an undo step or part of the saved diagram.
// New key; ACTIVE_SHAPE_KEY_LEGACY is the pre-rename key ('activeKind') —
// still read as a fallback so an existing user's saved tool selection
// survives the rename, but nothing writes to it going forward.
const ACTIVE_SHAPE_KEY = 'nesycat.editor.activeShape'
const ACTIVE_SHAPE_KEY_LEGACY = 'nesycat.editor.activeKind'
const ACTIVE_COLOR_KEY = 'nesycat.editor.activeColor'
const ACTIVE_CATEGORY_KEY = 'nesycat.editor.activeCategory'

function readLocalStorage(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}
function writeLocalStorage(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* e.g. storage disabled/full — just don't persist */ }
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
  // Read straight off the current document (no mirrored store field — see
  // state/store.ts's comment on why) — `diagram` is already selected above,
  // so this doesn't add its own subscription.
  const edgeStyle = diagram.edgeStyle ?? 'straight'
  const setEdgeStyle = useStore((s) => s.setEdgeStyle)
  const [importOpen, setImportOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const { screenToFlowPosition, getNodes } = useReactFlow()

  const [activeShape, setActiveShape] = useState<Shape>(() => {
    const stored = readLocalStorage(ACTIVE_SHAPE_KEY) ?? readLocalStorage(ACTIVE_SHAPE_KEY_LEGACY)
    return stored && SHAPE_RAIL.some((s) => s.shape === stored) ? (stored as Shape) : 'square'
  })
  const [activeCategory, setActiveCategory] = useState<string>(() => {
    const stored = readLocalStorage(ACTIVE_CATEGORY_KEY)
    return stored != null && (stored === '' || CATEGORIES.some((c) => c.key === stored)) ? stored : 'shape'
  })
  useEffect(() => { writeLocalStorage(ACTIVE_SHAPE_KEY, activeShape) }, [activeShape])

  // The active color — the creation default, exactly like activeShape: new
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
  const selectedPointShape = useMemo<Shape | undefined>(() => {
    if (selectedPoints.length === 0) return undefined
    const shapes = new Set(selectedPoints.map((id) => diagram.points[id]?.shape).filter(Boolean))
    return shapes.size === 1 ? ([...shapes][0] as Shape) : undefined
  }, [selectedPoints, diagram.points])

  // The top-pill Shape icon mirrors the active/selected form's shape.
  const activeShapeSymbol = SHAPE_RAIL.find((s) => s.shape === activeShape)?.symbol ?? 'kind-hexagon'

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
      ...(geometryFor(form.shape).hasCenterZone ? { dragHandle: `.${DRAG_HANDLE_CLASS}` } : {}),
    }))
  }, [diagram])

  // ── Build RF edges from lines (one RF edge per target) ─────────────
  const builtEdges: Edge[] = useMemo(() => {
    const out: Edge[] = []
    for (const line of diagram.lines) {
      const sp = pointToHandle(diagram, line.source)
      if (!sp) continue
      // The source's true tangent is the SAME for every branch of this
      // line (it's one point) — resolved once outside the per-target loop.
      const sourceDir = pointWorldNormal(diagram, line.source)
      // A hyperedge (2+ targets) — LineEdge.tsx routes its smoothstep elbow
      // AT the shared source instead of centered, so every branch's
      // cross-axis run starts from the same point instead of all coinciding
      // into one "trunk" that smears the split and hides the copy point.
      // Mirrored in ir/geometry-ir.ts's buildLineCmds off the SAME
      // line.targets.length check, for canvas/export parity.
      const hyper = line.targets.length > 1
      // Every branch of a hyperedge carries the line's name (user decision:
      // a fork's branches each show the type, not just the first) —
      // matching the exports' per-branch labels (ir/geometry-ir.ts's
      // buildLineCmds). '' (explicitly cleared, only reachable via a raw
      // import that bypassed the store's own renameLine safeguard) renders
      // neither text nor mask — see lineLabel's own comment.
      const label = lineLabel(line.name, line.id)
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
          data: {
            label, color: line.color,
            sourceDir, targetDir: pointWorldNormal(diagram, tid),
            hyper,
          },
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
      if (form && geometryFor(form.shape).pointIsForm) {
        const midId = pointIdsAt(form, geometryFor(form.shape).edgeKeys[0])[0]
        if (!midId) return { value: '', placeholder: '', sig: 'empty:' + form.id, disabled: true }
        return { value: diagram.points[midId]?.name ?? '', placeholder: midId, sig: 'points:' + midId, disabled: false }
      }
    }
    // The identity CENTRE point has NO name of its own — it IS the form, so its
    // name IS the form's name (one field, read/written on the form). Selecting it
    // shows/edits form.name, never a separate point name.
    if (selectionTarget.kind === 'points' && selectionTarget.ids.length === 1) {
      const pt = diagram.points[selectionTarget.ids[0]]
      if (pt?.edgeKey === 'center') {
        const form = diagram.forms.find((f) => f.id === pt.formId)
        if (form) return { value: form.name ?? '', placeholder: form.id, sig: 'forms:' + form.id, disabled: false }
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
      if (form && geometryFor(form.shape).pointIsForm) {
        const midId = pointIdsAt(form, geometryFor(form.shape).edgeKeys[0])[0]
        if (midId) renamePoints([midId], value)
        return // no point yet -> the field is disabled, nothing to do
      }
    }
    // Identity centre point → rename the FORM (its name is the form's name).
    if (selectionTarget.kind === 'points' && selectionTarget.ids.length === 1) {
      const pt = diagram.points[selectionTarget.ids[0]]
      if (pt?.edgeKey === 'center') {
        if (pt.formId) renameForms([pt.formId], value)
        return
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
  // triangle/square/circle/rhombus, but 50 for empty; see forms.ts's
  // nodeSize). A fresh form has no edges/points yet, so nodeSize reads
  // exactly the kind's own default — same SizableForm shape grid.ts's
  // snapCenterPosition expects.
  const createForm = useCallback(
    (shape: Shape, center: { x: number; y: number }) => {
      setActiveShape(shape)
      const freshForm = { shape, scale: undefined, edges: {} }
      const n = geometryFor(shape).nodeSize(freshForm as Form)
      const topLeft = { x: center.x - n / 2, y: center.y - n / 2 }
      // Grid ON: snapCenterPosition re-derives the center from `topLeft` (as
      // topLeft + n/2, i.e. our original `center`) and snaps THAT — so
      // feeding it our own about-to-be-used top-left snaps the true center,
      // not the top-left corner, while reusing the one snap definition
      // instead of duplicating it here.
      const position = gridEnabled ? snapCenterPosition(freshForm, topLeft) : topLeft
      useStore.getState().addForm(shape, position, activeColor)
    },
    [activeColor, gridEnabled],
  )

  // Click a Shape-rail tile. The SAME rail picks both point shapes and form
  // shapes, applied to the current selection:
  //   • point(s) selected → set their shape (any of the 5);
  //   • else form(s) selected → transform them;
  //   • else just set the active form tool (used by double-click / drag-create).
  const onPickShape = useCallback(
    (entry: { shape: Shape }) => {
      const pts = useStore.getState().selectedPoints
      if (pts.length > 0) {
        useStore.getState().setPointsShape(pts, entry.shape)
        return
      }
      setActiveShape(entry.shape)
      const ids = getNodes().filter((n) => n.selected).map((n) => n.id)
      if (ids.length > 0) useStore.getState().setFormsShape(ids, entry.shape)
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
      const shape = e.dataTransfer.getData('application/form-shape') as Shape
      if (!shape) return
      const flow = screenToFlowPosition({ x: e.clientX, y: e.clientY })
      createForm(shape, flow) // flow IS the intended center; createForm derives top-left per-shape
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
        createForm(activeShape, flow) // flow IS the intended center; createForm derives top-left per-shape
        lastPaneClickRef.current = 0
        return
      }
      lastPaneClickRef.current = now
    },
    [screenToFlowPosition, clearSelection, createForm, activeShape],
  )

  // Selecting form(s) clears any selected point (the other half of exclusivity).
  const onSelectionChange = useCallback(({ nodes: sel }: { nodes: Node[] }) => {
    if (sel.length === 0) return
    useStore.getState().clearSelection() // a form got selected → drop point selection
    // reflect the selected form's shape in the active tool (and so the top pill)
    if (sel.length === 1) {
      const form = useStore.getState().diagram.forms.find((f) => f.id === sel[0].id)
      if (form) setActiveShape(form.shape)
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
  // (see resolvePointForHandle's own comment on why not the "to" side used
  // to fall back to a plain append).
  const connectStartRef = useRef<{ clientX: number; clientY: number } | null>(null)
  // Live pointer position during an in-progress connection drag — updated on
  // every 'pointermove' between onConnectStart and onConnectEnd/unmount, so
  // onConnect can give the TARGET side a real gesture position too (there is
  // no React Flow drag-end event with client coords for the handle-to-handle
  // path onConnect covers; window pointermove is the only reliable source).
  // A single mutable ref, not state — this fires on every pixel of the drag
  // and must not trigger re-renders.
  const connectPointerRef = useRef<{ clientX: number; clientY: number } | null>(null)
  const onConnectPointerMove = useCallback((event: PointerEvent) => {
    connectPointerRef.current = { clientX: event.clientX, clientY: event.clientY }
  }, [])
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onConnectStart = useCallback((event: MouseEvent | TouchEvent, _params: any) => {
    const { clientX, clientY } = 'changedTouches' in event ? (event as TouchEvent).changedTouches[0] : (event as MouseEvent)
    connectStartRef.current = { clientX, clientY }
    connectPointerRef.current = { clientX, clientY }
    window.addEventListener('pointermove', onConnectPointerMove)
  }, [onConnectPointerMove])
  // Always remove the listener on unmount too, in case a connection drag is
  // abandoned mid-gesture (e.g. component unmounts before onConnectEnd fires).
  useEffect(() => () => window.removeEventListener('pointermove', onConnectPointerMove), [onConnectPointerMove])

  const onConnect = useCallback((params: Connection) => {
    if (!params.source || !params.target || !params.sourceHandle || !params.targetHandle) return
    const src = resolvePointForHandle(params.source, params.sourceHandle, connectStartRef.current, screenToFlowPosition, getNodes)
    const tgt = resolvePointForHandle(params.target, params.targetHandle, connectPointerRef.current, screenToFlowPosition, getNodes)
    if (!src || !tgt || src === tgt) return
    useStore.getState().addLine(src, tgt)
  }, [screenToFlowPosition, getNodes])

  // ── Drag from a point (or phantom) handle onto a form body → attach to
  // nearest edge ──────────────────────────────────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: any) => {
    window.removeEventListener('pointermove', onConnectPointerMove)
    if (connectionState.isValid || !connectionState.fromNode || !connectionState.fromHandle?.id) return
    const hid = connectionState.fromHandle.id as string
    const { clientX, clientY } = 'changedTouches' in event ? (event as TouchEvent).changedTouches[0] : (event as MouseEvent)
    // Click-vs-drag on a point's handle. React Flow consumes the pointer on a
    // handle for connection-dragging, so a point's own onClick never fires —
    // this is the ONE reliable place to catch "clicked a point (any point:
    // corner, centre, apex, side) to select it". A near-zero move = a click.
    const start = connectStartRef.current
    const moved = start ? Math.hypot(clientX - start.clientX, clientY - start.clientY) : Infinity
    if (moved < 5) {
      // A plain click (no drag) selects the nearest EXISTING point to where the
      // press LANDED — the same geometric resolver onNodeClick uses — never
      // trusting `hid` (which may be a phantom spot shadowing a real point, or
      // a neighbouring handle RF attributed the press to). Location is ground
      // truth, so this selects corner/centre/apex/inside/side identically. An
      // empty spot (no point there) stays a no-op; creation is double-click/drag.
      const pid = existingPointAtClient(clientX, clientY, connectionState.fromNode.id, screenToFlowPosition, getNodes)
      if (!pid) return
      setNodes((nds) => (nds.some((n) => n.selected) ? nds.map((n) => (n.selected ? { ...n, selected: false } : n)) : nds))
      const multi = 'metaKey' in event && ((event as MouseEvent).metaKey || (event as MouseEvent).ctrlKey)
      if (multi) useStore.getState().toggleSelectedPoint(pid)
      else useStore.getState().setSelectedPoints([pid])
      return
    }
    const fromPointId = resolvePointForHandle(connectionState.fromNode.id, hid, connectStartRef.current, screenToFlowPosition, getNodes)
    if (!fromPointId) return
    const newPtId = resolveDropPoint(clientX, clientY, connectionState.fromNode.id, screenToFlowPosition, getNodes)
    if (!newPtId) return
    useStore.getState().addLine(fromPointId, newPtId)
  }, [screenToFlowPosition, getNodes, onConnectPointerMove, setNodes])

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
    const geom = geometryFor(form.shape)
    const { rx, ry, lx, ly, n } = formLocalPoint(event, node, form)
    // Clicking on/near a point SELECTS that point. The dot itself is a React
    // Flow handle whose click React Flow consumes for connection-dragging, so
    // the point's own onClick never fires — but a plain click on the node body
    // next to the point DOES reach onNodeClick, and this is the reliable catch
    // for EVERY point (corner, centre, apex, side), no per-kind special case.
    const onPoint = nearestPointWithin(form, geom, lx, ly, n)
    if (onPoint) {
      setNodes((nds) => (nds.some((n) => n.selected) ? nds.map((n) => (n.selected ? { ...n, selected: false } : n)) : nds))
      if (event.metaKey || event.ctrlKey) useStore.getState().toggleSelectedPoint(onPoint)
      else useStore.getState().setSelectedPoints([onPoint])
      return
    }
    // Not on a point: a bare centre-zone click keeps the form selected; a ring
    // click reverts it.
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
    const geom = geometryFor(form.shape)
    const { rx, ry } = formLocalPoint(event, node, form)
    const edgeKey = geom.edgeAt(clamp01(rx), clamp01(ry))
    const onSpot = !!edgeKey && geom.regionShape(edgeKey).kind === 'spot'
    // A spot (corner/centre/apex) is always addable, even inside the centre
    // zone; a bare centre-zone double-click (a side there) is whole-form
    // selection, a no-op.
    if (!onSpot && geom.hasCenterZone && isInCenterZone(geom.body, rx, ry)) return
    if (!edgeKey) return
    const index = insertionIndex(form, edgeKey, clamp01(rx), clamp01(ry))
    useStore.getState().addPoint(node.id, edgeKey, undefined, index)
  }, [formLocalPoint])

  // ── Cursor territory inside a form, quiver-style — resolved centrally
  // (only Canvas has the full diagram, so only it can check point proximity)
  // in strict priority order: an existing point's own drag handle always
  // wins, regardless of inside/outside the body; then the inner "select the
  // whole form" zone; then the point-creation ring near the edges;
  // then nothing. Tracked in the store so FormNode renders exactly one
  // highlight — never a region and a point (or two regions) at once. ───────
  const onNodeMouseMove = useCallback((event: React.MouseEvent, node: Node) => {
    if (node.type !== 'form') return
    const d = useStore.getState().diagram
    const form = d.forms.find((f) => f.id === node.id)
    if (!form) return
    const geom = geometryFor(form.shape)

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
    // ONE pipeline: edgeAt resolves ANY spot (corner / centre / apex) within its
    // own disc, or else the nearest side. A SPOT wins from any direction —
    // resolved BEFORE the inside-body / centre-zone logic, so it activates
    // exactly within its disc whether the cursor came from inside or outside the
    // form. A SIDE only lives inside the body; the rest of the centre zone is
    // whole-form selection.
    const edgeKey = geom.edgeAt(clamp01(rx), clamp01(ry))
    if (edgeKey && geom.regionShape(edgeKey).kind === 'spot') {
      useStore.getState().setHover({ kind: 'edge', formId: node.id, edgeKey, rx: clamp01(rx), ry: clamp01(ry) })
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
  useEditorKeyboard()

  // React Flow's connection-radius handle search (see @xyflow/system's
  // getClosestHandle) is what decides BOTH whether the dangling wire's
  // rendered endpoint snaps to a handle AND whether onConnect resolves a
  // target handle at all on release — the same distance check drives both,
  // so whatever value we give it, "looks snapped" and "IS mechanism 1" are
  // already the same thing moment-to-moment. The bug was the radius itself
  // not reaching the whole interactive band: RingBandHitArea's real depth
  // (edge to the center-zone boundary) is n·(1−CENTER_SHRINK)/2 for a
  // centre-zone kind, or n/2 for a full-body kind (point/empty) — NOT the
  // narrower REGION_STRIPE_WIDTH visual stripe. A fixed guess undershoots
  // for any node bigger than the smallest default (a form's own .scale is
  // the only thing that grows n now — see forms.ts's fixed-size nodeSize
  // per shape — point count no longer does), which is exactly what produced
  // the "attaches at the rim, breaks free deeper in the SAME band" split the
  // user saw: two visually different endings for what is, underneath,
  // meant to be one mechanism. Deriving the radius from the diagram's own
  // current geometry keeps the two endings identical everywhere the ring
  // band itself is active, on any node size — not a bigger fixed guess.
  const connectionRadius = useMemo(() => {
    let maxBand = 20 // React Flow's own default — floor for an empty/tiny diagram
    for (const node of nodes) {
      if (node.type !== 'form') continue
      const form = diagram.forms.find((f) => f.id === node.id)
      if (!form) continue
      const geom = geometryFor(form.shape)
      const n = node.measured?.width ?? node.width ?? geom.nodeSize(form) * (form.scale ?? 1)
      const band = geom.hasCenterZone ? (n * (1 - CENTER_SHRINK)) / 2 : n / 2
      if (band > maxBand) maxBand = band
    }
    // The radius is GLOBAL (React Flow takes one scalar), so a single big
    // node would otherwise inflate snapping diagram-wide: at 4× scale the
    // band is 180px, wrapping EVERY point handle in a capture halo wider
    // than typical inter-form gaps — blank-canvas drops (the auto-create-
    // empty gesture) would stop being reachable near forms. 75 covers every
    // default-size band (45–50) and generously scaled-up forms alike, while
    // keeping a scaled-up form's snapping merely generous.
    return Math.min(maxBand, 75)
  }, [nodes, diagram.forms])

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
        // See connectionRadius's own computation above — sized to the
        // diagram's actual point-creation band, not a fixed guess.
        connectionRadius={connectionRadius}
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
        // Double-click on the pane CREATES a form (onPaneClick's own 350ms
        // two-click detector above) — React Flow's default dbl-click zoom
        // would fire on the exact same gesture and lurch the viewport right
        // as the new form appears.
        zoomOnDoubleClick={false}
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

      <TopRightPills
        gridEnabled={gridEnabled}
        toggleGridEnabled={toggleGridEnabled}
        pointsVisible={pointsVisible}
        togglePointsVisible={togglePointsVisible}
        edgeStyle={edgeStyle}
        setEdgeStyle={setEdgeStyle}
        onImportClick={() => setImportOpen(true)}
        onExportClick={() => setExportOpen(true)}
        topRight={topRight}
      />

      {importOpen && <ImportPanel onClose={() => setImportOpen(false)} />}
      {exportOpen && <ExportPanel diagram={diagram} onClose={() => setExportOpen(false)} />}

      <MainToolbar
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
        activeShapeSymbol={activeShapeSymbol}
        selectionTarget={selectionTarget}
        colorInfo={colorInfo}
        activeColor={activeColor}
        second={
          <SecondToolbar
            activeCategory={activeCategory}
            selectedPoints={selectedPoints}
            selectedPointShape={selectedPointShape}
            activeShape={activeShape}
            onPickShape={onPickShape}
            selectionTarget={selectionTarget}
            colorInfo={colorInfo}
            activeColor={activeColor}
            onColor={onColor}
            nameInfo={nameInfo}
            onName={onName}
            rotationInfo={rotationInfo}
            onRotate={onRotate}
            scaleInfo={scaleInfo}
            onScale={onScale}
            selectedFormIds={selectedFormIds}
          />
        }
      />
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
