import type { Diagram, Form, Point, Line, FormKind, EdgeKey, PointShape, Color } from './types'
import { newFormId, newPointId, newLineId } from './ids'
import { geometryFor } from './forms'

// All pure: take a Diagram, return a new Diagram (+ new id where relevant).
// The store snapshots each result into history (one entry per call).

// Fresh, empty edges/corners for a kind — sides start as [], corners as
// undefined (per geometry.corners: which edgeKeys are vertices vs sides).
function emptySlots(kind: FormKind): { edges: Record<EdgeKey, string[]>; corners: Record<EdgeKey, string | undefined> } {
  const geom = geometryFor(kind)
  const edges: Record<EdgeKey, string[]> = {}
  const corners: Record<EdgeKey, string | undefined> = {}
  for (const k of geom.edgeKeys) {
    if (k in geom.corners) corners[k] = undefined
    else edges[k] = []
  }
  return { edges, corners }
}

// All point ids currently attached to a form, across both its sides and corners.
function allFormPointIds(form: Form): Set<string> {
  const ids = new Set<string>()
  for (const k of Object.keys(form.edges)) for (const pid of form.edges[k]) ids.add(pid)
  for (const k of Object.keys(form.corners)) { const pid = form.corners[k]; if (pid) ids.add(pid) }
  return ids
}

// ── Forms ────────────────────────────────────────────────────────────
export function addForm(d: Diagram, kind: FormKind, position: { x: number; y: number }, color?: Color | null): [Diagram, string] {
  const id = newFormId(d)
  const form: Form = { id, kind, position, ...(color ? { color } : {}), ...emptySlots(kind) }
  return [{ ...d, forms: [...d.forms, form] }, id]
}

export function deleteForm(d: Diagram, id: string): Diagram {
  const form = d.forms.find((f) => f.id === id)
  if (!form) return d
  const ptIds = allFormPointIds(form)
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

// Multi-target rename (empty string clears the name → display falls back to id).
export function renameForms(d: Diagram, ids: string[], name: string): Diagram {
  const set = new Set(ids)
  const nm = name === '' ? undefined : name
  return { ...d, forms: d.forms.map((f) => (set.has(f.id) ? { ...f, name: nm } : f)) }
}

// Transform a form to a new kind. Edge keys differ per kind, so the form's
// points can't be carried over — they (and lines touching them) are dropped.
export function setFormKind(d: Diagram, id: string, kind: FormKind): Diagram {
  const form = d.forms.find((f) => f.id === id)
  if (!form || form.kind === kind) return d
  const ptIds = allFormPointIds(form)
  const points = { ...d.points }
  for (const pid of ptIds) delete points[pid]
  const forms = d.forms.map((f) => (f.id === id ? { ...f, kind, ...emptySlots(kind) } : f))
  return { ...d, forms, points, lines: pruneLines(d.lines, ptIds) }
}

export function setFormsKind(d: Diagram, ids: string[], kind: FormKind): Diagram {
  let out = d
  for (const id of ids) out = setFormKind(out, id, kind)
  return out
}

// Rotation in degrees, 0-359 (wraps); 0 clears back to the undefined default.
export function setFormsRotation(d: Diagram, ids: string[], rotation: number): Diagram {
  const set = new Set(ids)
  const deg = ((rotation % 360) + 360) % 360
  return { ...d, forms: d.forms.map((f) => (set.has(f.id) ? { ...f, rotation: deg === 0 ? undefined : deg } : f)) }
}

// Scale as a size multiplier, clamped to [0.25, 4]; exactly 1 clears back to
// the undefined default.
export function setFormsScale(d: Diagram, ids: string[], scale: number): Diagram {
  const set = new Set(ids)
  const s = Math.max(0.25, Math.min(4, scale))
  return { ...d, forms: d.forms.map((f) => (set.has(f.id) ? { ...f, scale: s === 1 ? undefined : s } : f)) }
}

// Color rail — null clears back to the undefined default (no colour).
export function setFormsColor(d: Diagram, ids: string[], color: Color | null): Diagram {
  const set = new Set(ids)
  return { ...d, forms: d.forms.map((f) => (set.has(f.id) ? { ...f, color: color ?? undefined } : f)) }
}

// ── Points ───────────────────────────────────────────────────────────
// A corner is a single slot: if it's already occupied, refuse (returns the id
// as '' — same "no-op" signal as "form not found") rather than stacking a
// second point on one vertex. `index` places the new point at that position
// in a SIDE's ordered list (clamped to the current length) — the gesture-
// driven insertion point forms.ts's insertionIndex works out; undefined
// (the default) appends, same as before. Corners ignore it — a single slot
// has no ordering to insert into.
export function addPoint(d: Diagram, formId: string, edgeKey: EdgeKey, shape: PointShape = 'empty', index?: number): [Diagram, string] {
  const form = d.forms.find((f) => f.id === formId)
  if (!form) return [d, '']
  const geom = geometryFor(form.kind)
  const isCorner = edgeKey in geom.corners
  if (isCorner && form.corners[edgeKey]) return [d, '']
  // A side with a geometry-declared capacity (forms.ts's maxPoints — only
  // 'empty' sets one, for its single middle point) is a DIFFERENT kind of
  // "full" than a corner's: nothing more CAN attach to an occupied corner,
  // but a drop on a full 'empty' form should still CONNECT — it's the same
  // shared point every wire runs to. So reuse the existing id instead of
  // refusing.
  if (!isCorner && geom.maxPoints !== undefined) {
    const list = form.edges[edgeKey] ?? []
    if (list.length >= geom.maxPoints) return [d, list[0]]
  }
  const id = newPointId(d)
  const point: Point = { id, shape, formId, edgeKey }
  let updated: Form
  if (isCorner) {
    updated = { ...form, corners: { ...form.corners, [edgeKey]: id } }
  } else {
    const list = form.edges[edgeKey] ?? []
    const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length))
    updated = { ...form, edges: { ...form.edges, [edgeKey]: [...list.slice(0, at), id, ...list.slice(at)] } }
  }
  const forms = d.forms.map((f) => (f.id === formId ? updated : f))
  return [{ ...d, forms, points: { ...d.points, [id]: point } }, id]
}

export function removePoint(d: Diagram, pointId: string): Diagram {
  const pt = d.points[pointId]
  if (!pt) return d
  const forms = d.forms.map((f) => {
    if (f.id !== pt.formId) return f
    if (pt.edgeKey in geometryFor(f.kind).corners) return { ...f, corners: { ...f.corners, [pt.edgeKey]: undefined } }
    return { ...f, edges: { ...f.edges, [pt.edgeKey]: (f.edges[pt.edgeKey] ?? []).filter((id) => id !== pointId) } }
  })
  const points = { ...d.points }
  delete points[pointId]
  return { ...d, forms, points, lines: pruneLines(d.lines, new Set([pointId])) }
}

export function renamePoint(d: Diagram, id: string, name: string): Diagram {
  const pt = d.points[id]
  if (!pt) return d
  return { ...d, points: { ...d.points, [id]: { ...pt, name } } }
}

export function renamePoints(d: Diagram, ids: string[], name: string): Diagram {
  const nm = name === '' ? undefined : name
  const points = { ...d.points }
  for (const id of ids) if (points[id]) points[id] = { ...points[id], name: nm }
  return { ...d, points }
}

export function setPointShape(d: Diagram, id: string, shape: PointShape): Diagram {
  const pt = d.points[id]
  if (!pt) return d
  return { ...d, points: { ...d.points, [id]: { ...pt, shape } } }
}

export function setPointsShape(d: Diagram, ids: string[], shape: PointShape): Diagram {
  const points = { ...d.points }
  let changed = false
  for (const id of ids) {
    const pt = points[id]
    if (pt && pt.shape !== shape) { points[id] = { ...pt, shape }; changed = true }
  }
  return changed ? { ...d, points } : d
}

// Color rail — null clears back to the undefined default (no colour).
export function setPointsColor(d: Diagram, ids: string[], color: Color | null): Diagram {
  const points = { ...d.points }
  const c = color ?? undefined
  let changed = false
  for (const id of ids) {
    const pt = points[id]
    if (pt && pt.color !== c) { points[id] = { ...pt, color: c }; changed = true }
  }
  return changed ? { ...d, points } : d
}

// ── Lines ────────────────────────────────────────────────────────────
export function addLine(d: Diagram, sourcePtId: string, targetPtId: string): [Diagram, string] {
  const id = newLineId(d)
  const line: Line = { id, source: sourcePtId, targets: [targetPtId] }
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

export function renameLines(d: Diagram, ids: string[], name: string): Diagram {
  const set = new Set(ids)
  const nm = name === '' ? undefined : name
  return { ...d, lines: d.lines.map((l) => (set.has(l.id) ? { ...l, name: nm } : l)) }
}

// Color rail — null clears back to the undefined default (no colour).
export function setLinesColor(d: Diagram, ids: string[], color: Color | null): Diagram {
  const set = new Set(ids)
  return { ...d, lines: d.lines.map((l) => (set.has(l.id) ? { ...l, color: color ?? undefined } : l)) }
}

// ── Helpers ──────────────────────────────────────────────────────────
function pruneLines(lines: Line[], removed: Set<string>): Line[] {
  return lines
    .map((l) => ({ ...l, targets: l.targets.filter((t) => !removed.has(t)) }))
    .filter((l) => !removed.has(l.source) && l.targets.length > 0)
}
