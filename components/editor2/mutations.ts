import type { Diagram, Form, Point, Line, FormKind, EdgeKey, PointShape } from './types'
import { newFormId, newPointId, newLineId } from './ids'
import { geometryFor } from './forms'
import { DEFAULT_COLOR } from './color'

// All pure: take a Diagram, return a new Diagram (+ new id where relevant).
// The store snapshots each result into history (one entry per call).

// ── Forms ────────────────────────────────────────────────────────────
export function addForm(d: Diagram, kind: FormKind, position: { x: number; y: number }): [Diagram, string] {
  const id = newFormId(d)
  const edges: Record<EdgeKey, string[]> = {}
  for (const k of geometryFor(kind).edgeKeys) edges[k] = []
  const form: Form = { id, kind, color: [...DEFAULT_COLOR], position, edges }
  return [{ ...d, forms: [...d.forms, form] }, id]
}

export function deleteForm(d: Diagram, id: string): Diagram {
  const form = d.forms.find((f) => f.id === id)
  if (!form) return d
  const ptIds = new Set<string>()
  for (const k of Object.keys(form.edges)) for (const pid of form.edges[k]) ptIds.add(pid)
  const points = { ...d.points }
  for (const pid of ptIds) delete points[pid]
  const lines = pruneLines(d.lines, ptIds)
  return { ...d, forms: d.forms.filter((f) => f.id !== id), points, lines }
}

export function moveForm(d: Diagram, id: string, position: { x: number; y: number }): Diagram {
  return { ...d, forms: d.forms.map((f) => (f.id === id ? { ...f, position } : f)) }
}

export function moveForms(d: Diagram, updates: Array<{ id: string; position: { x: number; y: number } }>): Diagram {
  const byId = new Map(updates.map((u) => [u.id, u.position]))
  return { ...d, forms: d.forms.map((f) => (byId.has(f.id) ? { ...f, position: byId.get(f.id)! } : f)) }
}

export function renameForm(d: Diagram, id: string, name: string): Diagram {
  return { ...d, forms: d.forms.map((f) => (f.id === id ? { ...f, name } : f)) }
}

// ── Points ───────────────────────────────────────────────────────────
export function addPoint(d: Diagram, formId: string, edgeKey: EdgeKey, shape: PointShape = 'dot'): [Diagram, string] {
  const form = d.forms.find((f) => f.id === formId)
  if (!form) return [d, '']
  const id = newPointId(d)
  const point: Point = { id, shape, color: [...DEFAULT_COLOR], formId, edgeKey }
  const edges = { ...form.edges, [edgeKey]: [...(form.edges[edgeKey] ?? []), id] }
  const forms = d.forms.map((f) => (f.id === formId ? { ...f, edges } : f))
  return [{ ...d, forms, points: { ...d.points, [id]: point } }, id]
}

export function removePoint(d: Diagram, pointId: string): Diagram {
  const pt = d.points[pointId]
  if (!pt) return d
  const forms = d.forms.map((f) =>
    f.id === pt.formId
      ? { ...f, edges: { ...f.edges, [pt.edgeKey]: (f.edges[pt.edgeKey] ?? []).filter((id) => id !== pointId) } }
      : f,
  )
  const points = { ...d.points }
  delete points[pointId]
  return { ...d, forms, points, lines: pruneLines(d.lines, new Set([pointId])) }
}

export function renamePoint(d: Diagram, id: string, name: string): Diagram {
  const pt = d.points[id]
  if (!pt) return d
  return { ...d, points: { ...d.points, [id]: { ...pt, name } } }
}

export function setPointShape(d: Diagram, id: string, shape: PointShape): Diagram {
  const pt = d.points[id]
  if (!pt) return d
  return { ...d, points: { ...d.points, [id]: { ...pt, shape } } }
}

// ── Lines ────────────────────────────────────────────────────────────
export function addLine(d: Diagram, sourcePtId: string, targetPtId: string): [Diagram, string] {
  const id = newLineId(d)
  const line: Line = { id, color: [...DEFAULT_COLOR], source: sourcePtId, targets: [targetPtId] }
  return [{ ...d, lines: [...d.lines, line] }, id]
}

export function addLineTarget(d: Diagram, lineId: string, targetPtId: string): Diagram {
  return {
    ...d,
    lines: d.lines.map((l) =>
      l.id === lineId && !l.targets.includes(targetPtId) ? { ...l, targets: [...l.targets, targetPtId] } : l,
    ),
  }
}

export function deleteLine(d: Diagram, lineId: string): Diagram {
  return { ...d, lines: d.lines.filter((l) => l.id !== lineId) }
}

export function deleteLineTarget(d: Diagram, lineId: string, idx: number): Diagram {
  return {
    ...d,
    lines: d.lines
      .map((l) => (l.id === lineId ? { ...l, targets: l.targets.filter((_, i) => i !== idx) } : l))
      .filter((l) => l.targets.length > 0),
  }
}

export function renameLine(d: Diagram, id: string, name: string): Diagram {
  return { ...d, lines: d.lines.map((l) => (l.id === id ? { ...l, name } : l)) }
}

// ── Helpers ──────────────────────────────────────────────────────────
function pruneLines(lines: Line[], removed: Set<string>): Line[] {
  return lines
    .map((l) => ({ ...l, targets: l.targets.filter((t) => !removed.has(t)) }))
    .filter((l) => !removed.has(l.source) && l.targets.length > 0)
}
