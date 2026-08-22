// The pure core of every drawing tool: (Diagram, args) -> Result. No
// Supabase, no I/O — this is what mcp/test/*.test.ts exercises directly.
// tools/drawing.ts is the thin Supabase-facing wrapper: load row -> call one
// of these -> write row back.
import type { Diagram, Shape, Color } from '../vendor/editor/domain/types.js'
import { geometryFor, SHAPES } from '../vendor/editor/domain/forms.js'
import {
  addForm, deleteForm, moveForm, renameForm,
  addPoint, removePoint, renamePoint,
  addLine, addLineTarget, deleteLine, renameLine,
} from '../vendor/editor/domain/mutations.js'
import { restoreDiagram } from '../vendor/editor/persist/io.js'

export type OpResult = { ok: true; diagram: Diagram; id?: string } | { ok: false; error: string }

export type ElementKind = 'form' | 'point' | 'line'

function validated(d: Diagram, id?: string): OpResult {
  return { ok: true, diagram: restoreDiagram(d), id }
}

export function addFormOp(
  d: Diagram,
  args: { shape: Shape; position?: { x: number; y: number }; name?: string; color?: Color },
): OpResult {
  if (!SHAPES.includes(args.shape)) {
    return { ok: false, error: `Invalid shape "${args.shape}" — valid shapes: ${SHAPES.join(', ')}` }
  }
  let [next, id] = addForm(d, args.shape, args.position ?? { x: 0, y: 0 }, args.color ?? null)
  if (args.name) next = renameForm(next, id, args.name)
  return validated(next, id)
}

export function addPointOp(
  d: Diagram,
  args: { formId: string; edgeKey: string; name?: string; shape?: Shape },
): OpResult {
  const form = d.forms.find((f) => f.id === args.formId)
  if (!form) return { ok: false, error: `No form found with id ${args.formId}` }
  const validKeys = geometryFor(form.shape).edgeKeys
  if (!validKeys.includes(args.edgeKey)) {
    return {
      ok: false,
      error: `"${args.edgeKey}" is not a valid edge key for a ${form.shape} — valid keys: ${validKeys.join(', ')}`,
    }
  }
  let [next, id] = addPoint(d, args.formId, args.edgeKey, args.shape ?? 'empty')
  if (args.name) next = renamePoint(next, id, args.name)
  return validated(next, id)
}

export function addLineOp(
  d: Diagram,
  args: { sourcePointId: string; targetPointIds: string[]; name?: string },
): OpResult {
  if (!d.points[args.sourcePointId]) return { ok: false, error: `No point found with id ${args.sourcePointId}` }
  if (args.targetPointIds.length === 0) return { ok: false, error: 'targetPointIds must have at least one point id' }
  for (const t of args.targetPointIds) {
    if (!d.points[t]) return { ok: false, error: `No point found with id ${t} (targetPointIds)` }
  }
  const [first, ...rest] = args.targetPointIds
  let [next, id] = addLine(d, args.sourcePointId, first)
  for (const t of rest) next = addLineTarget(next, id, t)
  if (args.name) next = renameLine(next, id, args.name)
  return validated(next, id)
}

export function removeElementOp(d: Diagram, kind: ElementKind, id: string): OpResult {
  switch (kind) {
    case 'form':
      if (!d.forms.some((f) => f.id === id)) return { ok: false, error: `No form found with id ${id}` }
      return validated(deleteForm(d, id))
    case 'point':
      if (!d.points[id]) return { ok: false, error: `No point found with id ${id}` }
      return validated(removePoint(d, id))
    case 'line':
      if (!d.lines.some((l) => l.id === id)) return { ok: false, error: `No line found with id ${id}` }
      return validated(deleteLine(d, id))
  }
}

export function setElementNameOp(d: Diagram, kind: ElementKind, id: string, name: string): OpResult {
  switch (kind) {
    case 'form':
      if (!d.forms.some((f) => f.id === id)) return { ok: false, error: `No form found with id ${id}` }
      return validated(renameForm(d, id, name))
    case 'point':
      if (!d.points[id]) return { ok: false, error: `No point found with id ${id}` }
      return validated(renamePoint(d, id, name))
    case 'line':
      if (!d.lines.some((l) => l.id === id)) return { ok: false, error: `No line found with id ${id}` }
      return validated(renameLine(d, id, name))
  }
}

export function moveFormOp(d: Diagram, formId: string, position: { x: number; y: number }): OpResult {
  if (!d.forms.some((f) => f.id === formId)) return { ok: false, error: `No form found with id ${formId}` }
  return validated(moveForm(d, formId, position))
}

export interface ValidateResult {
  ok: boolean
  problems: string[]
  diagram: Diagram
}

// restoreDiagram (persist/io.ts) is a load-boundary NORMALIZER, not a
// validator — legacy/malformed shapes are dropped or coerced silently
// rather than reported (see its own header comment). It also never checks
// cross-references it didn't itself just build: a line naming a point id
// that never existed, or a point naming a formId that never existed,
// survives it untouched (canonLine/canonPoint just String()-coerce whatever
// id was given). Those referential checks are done here, against the
// restored diagram, on top of restoreDiagram's own normalization.
export function validateDiagram(raw: unknown): ValidateResult {
  const diagram = restoreDiagram(raw)
  const problems: string[] = []
  const formIds = new Set(diagram.forms.map((f) => f.id))
  const pointIds = new Set(Object.keys(diagram.points))

  for (const [pid, pt] of Object.entries(diagram.points)) {
    if (!formIds.has(pt.formId)) problems.push(`point ${pid} references missing form ${pt.formId}`)
  }
  for (const form of diagram.forms) {
    for (const [edgeKey, ids] of Object.entries(form.edges)) {
      for (const pid of ids) {
        if (!pointIds.has(pid)) problems.push(`form ${form.id} edge ${edgeKey} references missing point ${pid}`)
      }
    }
  }
  for (const line of diagram.lines) {
    if (!pointIds.has(line.source)) problems.push(`line ${line.id} references missing source point ${line.source}`)
    for (const t of line.targets) {
      if (!pointIds.has(t)) problems.push(`line ${line.id} references missing target point ${t}`)
    }
  }

  return { ok: problems.length === 0, problems, diagram }
}

// Pure part of duplicate_diagram: a structural copy of a diagram's data,
// independent of new id assignment (the actual new diagrams.id comes from
// Postgres's gen_random_uuid() default on insert — see tools/diagrams.ts —
// there is no id inside the Diagram JSON itself to duplicate). A plain JSON
// round-trip is enough since Diagram is JSON-safe data end to end, and
// guarantees the copy shares no object identity with the original (so
// mutating one can never affect the other).
export function duplicateData(data: Diagram): Diagram {
  return JSON.parse(JSON.stringify(data)) as Diagram
}

// The other pure part of duplicate_diagram: the default title, when the
// caller doesn't supply one explicitly.
export function duplicateTitle(originalTitle: string, explicitTitle?: string): string {
  return explicitTitle ?? `${originalTitle} (copy)`
}
