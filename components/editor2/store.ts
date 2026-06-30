import { create } from 'zustand'
import type { Diagram, FormKind, PointShape } from './types'
import * as M from './mutations'

const MAX_HISTORY = 100

export type EdgePathMode = 'straight' | 'smoothstep'

interface State {
  diagram: Diagram
  selectedPoints: string[] // point ids
  edgePath: EdgePathMode

  history: Diagram[]
  historyIndex: number
  undo: () => void
  redo: () => void

  toggleEdgePath: () => void
  setSelectedPoints: (ids: string[]) => void
  toggleSelectedPoint: (id: string) => void
  clearSelection: () => void

  // Mutations (delegate to pure functions; one history entry each)
  addForm: (kind: FormKind, position: { x: number; y: number }) => string
  deleteForm: (id: string) => void
  moveForm: (id: string, position: { x: number; y: number }) => void
  moveForms: (updates: Array<{ id: string; position: { x: number; y: number } }>) => void
  renameForm: (id: string, name: string) => void

  addPoint: (formId: string, edgeKey: string, shape?: PointShape) => string
  removePoint: (id: string) => void
  renamePoint: (id: string, name: string) => void
  setPointShape: (id: string, shape: PointShape) => void

  addLine: (sourcePtId: string, targetPtId: string) => string
  addLineTarget: (lineId: string, targetPtId: string) => void
  deleteLine: (lineId: string) => void
  deleteLineTarget: (lineId: string, idx: number) => void
  renameLine: (id: string, name: string) => void
}

const emptyDiagram: Diagram = { schemaVersion: 1, forms: [], points: {}, lines: [] }

export const useStore = create<State>((set, get) => {
  const setCur = (updated: Diagram) => {
    const { history, historyIndex } = get()
    const newHistory = [...history.slice(0, historyIndex + 1), updated].slice(-MAX_HISTORY)
    set({ diagram: updated, history: newHistory, historyIndex: newHistory.length - 1 })
  }

  return {
    diagram: emptyDiagram,
    selectedPoints: [],
    edgePath: 'straight',
    history: [emptyDiagram],
    historyIndex: 0,

    undo: () => {
      const { history, historyIndex } = get()
      if (historyIndex <= 0) return
      set({ diagram: history[historyIndex - 1], historyIndex: historyIndex - 1 })
    },
    redo: () => {
      const { history, historyIndex } = get()
      if (historyIndex >= history.length - 1) return
      set({ diagram: history[historyIndex + 1], historyIndex: historyIndex + 1 })
    },

    toggleEdgePath: () => set({ edgePath: get().edgePath === 'straight' ? 'smoothstep' : 'straight' }),
    setSelectedPoints: (ids) => {
      if (ids.length === 0 && get().selectedPoints.length === 0) return
      set({ selectedPoints: ids })
    },
    toggleSelectedPoint: (id) => {
      const cur = get().selectedPoints
      set({ selectedPoints: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
    },
    clearSelection: () => {
      if (get().selectedPoints.length > 0) set({ selectedPoints: [] })
    },

    addForm: (kind, position) => {
      const [d, id] = M.addForm(get().diagram, kind, position)
      setCur(d)
      return id
    },
    deleteForm: (id) => setCur(M.deleteForm(get().diagram, id)),
    moveForm: (id, position) => setCur(M.moveForm(get().diagram, id, position)),
    moveForms: (updates) => { if (updates.length) setCur(M.moveForms(get().diagram, updates)) },
    renameForm: (id, name) => setCur(M.renameForm(get().diagram, id, name)),

    addPoint: (formId, edgeKey, shape) => {
      const [d, id] = M.addPoint(get().diagram, formId, edgeKey, shape)
      if (id) setCur(d)
      return id
    },
    removePoint: (id) => setCur(M.removePoint(get().diagram, id)),
    renamePoint: (id, name) => setCur(M.renamePoint(get().diagram, id, name)),
    setPointShape: (id, shape) => setCur(M.setPointShape(get().diagram, id, shape)),

    addLine: (src, tgt) => {
      const [d, id] = M.addLine(get().diagram, src, tgt)
      setCur(d)
      return id
    },
    addLineTarget: (lineId, tgt) => setCur(M.addLineTarget(get().diagram, lineId, tgt)),
    deleteLine: (lineId) => setCur(M.deleteLine(get().diagram, lineId)),
    deleteLineTarget: (lineId, idx) => setCur(M.deleteLineTarget(get().diagram, lineId, idx)),
    renameLine: (id, name) => setCur(M.renameLine(get().diagram, id, name)),
  }
})

// Hydration flag — autosave reads it to distinguish "store loaded with DB data"
// from "user edited", so cross-diagram navigation doesn't write back to the old id.
let _hydrating = false
export function isHydrating(): boolean {
  return _hydrating
}

export function initStore(initial: Diagram) {
  const d: Diagram = {
    schemaVersion: initial.schemaVersion ?? 1,
    forms: initial.forms ?? [],
    points: initial.points ?? {},
    lines: initial.lines ?? [],
  }
  _hydrating = true
  try {
    useStore.setState({ diagram: d, history: [d], historyIndex: 0, selectedPoints: [] })
  } finally {
    _hydrating = false
  }
}
