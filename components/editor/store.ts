import { create } from 'zustand'
import type { DiagramData, DiagramPoint, XY } from './types'
import * as M from './mutations'

const MAX_HISTORY = 100

export interface Visibility {
  points: boolean
  lines: boolean
  triangles: boolean
  rectangles: boolean
  circles: boolean
  rhombuses: boolean
  empties: boolean
}

export interface SelectedPoint {
  pointName: string  // display label — identity comes from container context
  container: string  // "${nodeId}|${handleId}" e.g. "R1|right-0", "D1|left-down-0", "E1|right-0"
}

export type EdgePathMode = 'straight' | 'smoothstep'

type Side = 'left' | 'right'
type NodeSide = 'left' | 'right' | 'center' | 'down' | 'up' | 'total'
type Slot = 'down' | 'center' | 'up'
export type NodeKind = 'triangle' | 'rectangle' | 'circle' | 'rhombus' | 'empty'

interface State {
  visibility: Visibility
  diagram: DiagramData
  selectedPoints: SelectedPoint[]
  pointsExclusive: boolean
  edgePath: EdgePathMode
  toggleEdgePath: () => void

  // Undo/redo
  history: DiagramData[]
  historyIndex: number
  undo: () => void
  redo: () => void

  toggleVisibility: (kind: keyof Visibility) => void
  setSelectedPoints: (pts: SelectedPoint[], exclusive: boolean) => void
  toggleSelectedPoint: (pt: SelectedPoint) => void

  addPoint: (nodeName: string, side: NodeSide, label?: string, slot?: Slot) => number
  removePointOnNode: (nodeName: string, side: NodeSide, index: number, slot?: Slot) => void
  attachPoint: (lineName: string, end: M.LineEnd, nodeName: string, side: Side | 'up' | 'down', slot?: Slot) => number
  setPointLabel: (nodeName: string, side: NodeSide, index: number, label: string, slot?: Slot) => void

  addLine: (source: DiagramPoint, target: DiagramPoint) => string
  addLineTarget: (lineName: string, target: DiagramPoint) => void
  addLineWithFreeEnd: (anchor: DiagramPoint, freeRole: 'source' | 'target', emptyPosition: XY) => { emptyName: string; lineName: string }
  deleteLine: (name: string) => void
  deleteLineTarget: (lineName: string, index: number) => void
  renameLine: (oldName: string, newName: string) => boolean

  importDiagram: (d: DiagramData) => void

  addNode: (kind: Exclude<NodeKind, 'empty'>, position: XY, name?: string) => string
  addEmpty: (position: XY, side?: Side, label?: string, name?: string) => string
  deleteNode: (kind: NodeKind, name: string) => void
  renameNode: (kind: NodeKind, oldName: string, newName: string) => boolean

  // One commit per drag session (one history entry).
  updateNodePosition: (nodeName: string, position: XY) => void
  updateNodePositions: (updates: Array<{ id: string; position: XY }>) => void
}

const emptyDiagram: DiagramData = { empties: [], lines: [], triangles: [], rhombuses: [], circles: [], rectangles: [] }
const defaultVis: Visibility = { points: true, lines: true, triangles: true, rectangles: true, circles: true, rhombuses: true, empties: true }

export const useStore = create<State>((set, get) => {
  const setCur = (updated: DiagramData) => {
    const { history, historyIndex } = get()
    const newHistory = [...history.slice(0, historyIndex + 1), updated].slice(-MAX_HISTORY)
    set({ diagram: updated, history: newHistory, historyIndex: newHistory.length - 1 })
  }

  return {
    visibility: defaultVis,
    diagram: emptyDiagram,
    history: [emptyDiagram],
    historyIndex: 0,
    selectedPoints: [],
    pointsExclusive: false,
    edgePath: 'straight',
    toggleEdgePath: () => {
      const next: EdgePathMode = get().edgePath === 'straight' ? 'smoothstep' : 'straight'
      set({ edgePath: next })
    },

    undo: () => {
      const { history, historyIndex } = get()
      if (historyIndex <= 0) return
      const prev = history[historyIndex - 1]
      set({ diagram: prev, historyIndex: historyIndex - 1 })
    },
    redo: () => {
      const { history, historyIndex } = get()
      if (historyIndex >= history.length - 1) return
      const next = history[historyIndex + 1]
      set({ diagram: next, historyIndex: historyIndex + 1 })
    },

    toggleVisibility: (kind) => { const v = { ...get().visibility, [kind]: !get().visibility[kind] }; set({ visibility: v }) },
    setSelectedPoints: (pts, exclusive) => {
      if (pts.length === 0 && get().selectedPoints.length === 0) return
      set({ selectedPoints: pts, pointsExclusive: exclusive })
    },
    toggleSelectedPoint: (pt) => {
      const c = get().selectedPoints
      const exists = c.some((p) => p.container === pt.container)
      set({ selectedPoints: exists ? c.filter((p) => p.container !== pt.container) : [...c, pt], pointsExclusive: false })
    },

    addPoint: (nodeName, side, label, slot) => { const [d, idx] = M.addPoint(get().diagram, nodeName, side, label, slot); setCur(d); return idx },
    removePointOnNode: (nodeName, side, index, slot) => setCur(M.removePointOnNode(get().diagram, nodeName, side, index, slot)),
    attachPoint: (lineName, end, nodeName, side, slot) => { const [d, idx] = M.attachPoint(get().diagram, lineName, end, nodeName, side, slot); setCur(d); return idx },
    setPointLabel: (nodeName, side, index, label, slot) => setCur(M.setPointLabel(get().diagram, nodeName, side, index, label, slot)),

    addLine: (source, target) => { const [d, n] = M.addLine(get().diagram, source, target); setCur(d); return n },
    addLineTarget: (lineName, target) => setCur(M.addLineTarget(get().diagram, lineName, target)),
    addLineWithFreeEnd: (anchor, freeRole, emptyPosition) => { const [d, r] = M.addLineWithFreeEnd(get().diagram, anchor, freeRole, emptyPosition); setCur(d); return r },
    deleteLine: (name) => setCur(M.deleteLine(get().diagram, name)),
    deleteLineTarget: (lineName, index) => setCur(M.deleteLineTarget(get().diagram, lineName, index)),
    renameLine: (oldName, newName) => { const [d, ok] = M.renameLine(get().diagram, oldName, newName); if (ok) setCur(d); return ok },

    importDiagram: (d) => setCur({ ...emptyDiagram, ...d }),

    addNode: (kind, position, name) => {
      const add = { triangle: M.addTriangle, rectangle: M.addRectangle, circle: M.addCircle, rhombus: M.addRhombus }[kind]
      const [d, n] = add(get().diagram, position, name); setCur(d); return n
    },
    addEmpty: (position, side, label, name) => { const [d, n] = M.addEmpty(get().diagram, position, side, label, name); setCur(d); return n },
    deleteNode: (kind, name) => {
      const del = { triangle: M.deleteTriangle, rectangle: M.deleteRectangle, circle: M.deleteCircle, rhombus: M.deleteRhombus, empty: M.deleteEmpty }[kind]
      setCur(del(get().diagram, name))
    },
    renameNode: (kind, oldName, newName) => {
      const ren = { triangle: M.renameTriangle, rectangle: M.renameRectangle, circle: M.renameCircle, rhombus: M.renameRhombus, empty: M.renameEmpty }[kind]
      const [d, ok] = ren(get().diagram, oldName, newName); if (ok) setCur(d); return ok
    },

    updateNodePosition: (nodeName, position) => {
      const d = get().diagram
      const stamp = <T extends { id: string; position: XY }>(xs: T[]): T[] =>
        xs.map((x) => x.id === nodeName ? { ...x, position } : x)
      const updated: DiagramData = {
        ...d,
        empties:    stamp(d.empties),
        triangles:  stamp(d.triangles),
        rectangles: stamp(d.rectangles),
        circles:    stamp(d.circles),
        rhombuses:  stamp(d.rhombuses),
      }
      setCur(updated)
    },
    updateNodePositions: (updates) => {
      if (updates.length === 0) return
      const byId = new Map(updates.map((u) => [u.id, u.position]))
      const d = get().diagram
      const stamp = <T extends { id: string; position: XY }>(xs: T[]): T[] =>
        xs.map((x) => byId.has(x.id) ? { ...x, position: byId.get(x.id)! } : x)
      const updated: DiagramData = {
        ...d,
        empties:    stamp(d.empties),
        triangles:  stamp(d.triangles),
        rectangles: stamp(d.rectangles),
        circles:    stamp(d.circles),
        rhombuses:  stamp(d.rhombuses),
      }
      setCur(updated)
    },
  }
})

// Hydration flag. Autosave reads this to distinguish "the store was just
// loaded with DB data" from "the user edited the diagram". Without it,
// navigating between diagrams swaps store data via setState → subscribers fire
// → autosave treats the swap as an edit and writes the NEW diagram's data back
// to the OLD diagramId (closure), corrupting the source diagram. See save.ts.
let _hydrating = false
export function isHydrating(): boolean {
  return _hydrating
}

export function initStore(initial: DiagramData) {
  const d = { ...emptyDiagram, ...initial }
  _hydrating = true
  try {
    useStore.setState({ diagram: d, history: [d], historyIndex: 0 })
  } finally {
    _hydrating = false
  }
}
