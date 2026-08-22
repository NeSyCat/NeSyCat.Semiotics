import type { Diagram, Form, Point, Line, Shape, EdgeKey, Color } from './types'
import { newFormId, newPointId, newLineId } from './ids'
import { geometryFor } from './forms'

// All pure: take a Diagram, return a new Diagram (+ new id where relevant).
// The store snapshots each result into history (one entry per call).

// Fresh, empty edges for a shape — every side starts as [].
function emptySlots(shape: Shape): { edges: Record<EdgeKey, string[]> } {
  const geom = geometryFor(shape)
  const edges: Record<EdgeKey, string[]> = {}
  for (const k of geom.edgeKeys) edges[k] = []
  return { edges }
}

// All point ids currently attached to a form, across its sides.
function allFormPointIds(form: Form): Set<string> {
  const ids = new Set<string>()
  for (const k of Object.keys(form.edges)) for (const pid of form.edges[k]) ids.add(pid)
  return ids
}

// ── Forms ────────────────────────────────────────────────────────────
export function addForm(d: Diagram, shape: Shape, position: { x: number; y: number }, color?: Color | null): [Diagram, string] {
  const id = newFormId(d)
  const form: Form = { id, shape, position, ...(color ? { color } : {}), ...emptySlots(shape) }
  const withForm: Diagram = { ...d, forms: [...d.forms, form] }
  // Shapes whose geometry declares pointIsForm (forms.ts's flag — only
  // 'empty' today) start life WITH that point already attached, in the same
  // returned Diagram: the middle point IS the form (emptyGeometry's own
  // comment), so it should exist the moment the form does rather than
  // waiting for a second gesture/history entry. Reuses addPoint itself so
  // id-generation, shape defaults, and capacity all stay defined in exactly
  // one place; the first edge key is the only one a pointIsForm shape has.
  // A shape with an ordinary OPTIONAL capacity-1 slot (triangle's peak) is
  // NOT seeded here — pointIsForm, not edgeCapacity, decides seeding.
  const geom = geometryFor(shape)
  if (geom.pointIsForm) {
    const edgeKey = geom.edgeKeys[0]
    if (edgeKey !== undefined) {
      const [seeded] = addPoint(withForm, id, edgeKey)
      return [seeded, id]
    }
  }
  return [withForm, id]
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

// Transform a form to a new shape. Edge keys differ per shape, so the form's
// points can't be carried over — they (and lines touching them) are dropped.
export function setFormShape(d: Diagram, id: string, shape: Shape): Diagram {
  const form = d.forms.find((f) => f.id === id)
  if (!form || form.shape === shape) return d
  const ptIds = allFormPointIds(form)
  const points = { ...d.points }
  for (const pid of ptIds) delete points[pid]
  const forms = d.forms.map((f) => (f.id === id ? { ...f, shape, ...emptySlots(shape) } : f))
  return { ...d, forms, points, lines: pruneLines(d.lines, ptIds) }
}

export function setFormsShape(d: Diagram, ids: string[], shape: Shape): Diagram {
  let out = d
  for (const id of ids) out = setFormShape(out, id, shape)
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
// `index` places the new point at that position in the SIDE's ordered list
// (clamped to the current length) — the gesture-driven insertion point
// forms.ts's insertionIndex works out; undefined (the default) appends.
export function addPoint(d: Diagram, formId: string, edgeKey: EdgeKey, shape: Shape = 'empty', index?: number): [Diagram, string] {
  const form = d.forms.find((f) => f.id === formId)
  if (!form) return [d, '']
  const geom = geometryFor(form.shape)
  // An edge with a geometry-declared capacity (forms.ts's edgeCapacity —
  // 'empty's self, or triangle's peak): a drop on a full edge should still
  // CONNECT — it's the same shared point every wire runs to. So reuse the
  // existing id instead of refusing.
  const capacity = geom.edgeCapacity?.[edgeKey]
  if (capacity !== undefined) {
    const list = form.edges[edgeKey] ?? []
    if (list.length >= capacity) return [d, list[0]]
  }
  const id = newPointId(d)
  const point: Point = { id, shape, formId, edgeKey }
  const list = form.edges[edgeKey] ?? []
  const at = index === undefined ? list.length : Math.max(0, Math.min(index, list.length))
  const updated: Form = { ...form, edges: { ...form.edges, [edgeKey]: [...list.slice(0, at), id, ...list.slice(at)] } }
  const forms = d.forms.map((f) => (f.id === formId ? updated : f))
  return [{ ...d, forms, points: { ...d.points, [id]: point } }, id]
}

export function removePoint(d: Diagram, pointId: string): Diagram {
  const pt = d.points[pointId]
  if (!pt) return d
  // A pointIsForm shape ('empty') IS its middle point — the form must never
  // exist without it, so deleting the point deletes the whole form
  // (deleteForm also prunes the point's lines, same as any form removal).
  // A capacity-1 edge WITHOUT pointIsForm (triangle's peak) is an ordinary
  // optional slot instead — falls through to the normal single-point
  // removal below, leaving the form intact.
  const owner = d.forms.find((f) => f.id === pt.formId)
  if (owner && geometryFor(owner.shape).pointIsForm) {
    return deleteForm(d, owner.id)
  }
  const forms = d.forms.map((f) =>
    f.id !== pt.formId ? f : { ...f, edges: { ...f.edges, [pt.edgeKey]: (f.edges[pt.edgeKey] ?? []).filter((id) => id !== pointId) } },
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

export function renamePoints(d: Diagram, ids: string[], name: string): Diagram {
  const nm = name === '' ? undefined : name
  const points = { ...d.points }
  for (const id of ids) if (points[id]) points[id] = { ...points[id], name: nm }
  return { ...d, points }
}

export function setPointShape(d: Diagram, id: string, shape: Shape): Diagram {
  const pt = d.points[id]
  if (!pt) return d
  return { ...d, points: { ...d.points, [id]: { ...pt, shape } } }
}

export function setPointsShape(d: Diagram, ids: string[], shape: Shape): Diagram {
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
// Each wire is its own independently-named Line — including every branch
// fanning out of a single source point (e.g. through a copy-node's 'empty'
// form). A new line always starts unnamed; naming one branch never affects
// any sibling or downstream line.
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

// Renaming a wire affects ONLY that wire — no propagation to siblings
// sharing its source point, and no cascade downstream through copy points.
export function renameLine(d: Diagram, id: string, name: string): Diagram {
  const set = new Set([id])
  // '' clears the name (undefined).
  const nm = name === '' ? undefined : name
  return { ...d, lines: d.lines.map((l) => (set.has(l.id) ? { ...l, name: nm } : l)) }
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
// Exported so io.ts's restoreDiagram can reuse the same dedupe+degenerate-
// drop logic when drop-silently pruning corner points / 'point'-shape forms
// on load.
export function pruneLines(lines: Line[], removed: Set<string>): Line[] {
  return lines
    .map((l) => ({ ...l, targets: l.targets.filter((t) => !removed.has(t)) }))
    .filter((l) => !removed.has(l.source) && l.targets.length > 0)
}
