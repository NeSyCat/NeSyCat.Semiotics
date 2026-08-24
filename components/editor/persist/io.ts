import type { Diagram, Form, Point, Line, Color, Shape } from '../domain/types'
import { geometryFor, SHAPES } from '../domain/forms'
import { EDGE_STYLES, type EdgeStyle } from '../domain/wirepath'
import { pruneLines } from '../domain/mutations'

// Single load-boundary normalizer. Persisted JSON arrives from Supabase
// (`diagrams.data` jsonb) or a JSON import; this fills defaults and rebuilds
// each record in canonical field order (Postgres JSONB reorders object keys on
// insert, so we re-canonicalize to keep autosave's JSON dedupe stable).
//
// Unrecognized/legacy JSON (anything without forms/points/lines) simply
// restores as an empty diagram — there is no migration path.
//
// Two deliberate breaking data-model simplifications, DROPPED SILENTLY (no
// migration): forms no longer have corner (vertex) slots — only side/arc
// points — and the 'point' FormShape (a standalone dot-bodied form) no
// longer exists. A raw diagram saved under the old model may still carry
// corner points (an old `corners` map, or a point whose edgeKey looks like
// 'v0'/'v1'/…) and whole 'point'-shape forms; dropRemovedShapes below strips
// both, along with the Points they owned and any Lines that referenced them
// (via mutations.ts's pruneLines — same dedupe+degenerate-drop logic the
// empty-form collapse below uses). Runs BEFORE canonForm/canonPoint so
// geometryFor never sees the no-longer-valid 'point' shape.
//
// READ SHIM (Phase C, kind -> shape rename): a Form's shape field used to be
// called `kind`. Saved diagrams (DB jsonb, share-link fragments) may still
// carry the old field name — canonForm below reads `f.shape ?? f.kind` (new
// field preferred, old accepted) so every pre-existing save keeps loading.
// dropRemovedShapes runs on RAW pre-canon data (before that fallback ever
// applies), so its own 'point'-shape-drop check reads both f.shape and
// f.kind directly — an old save uses `kind`, a save written from now on uses
// `shape`. Everything WRITTEN from here on uses `shape` only; there is no
// corresponding write-shim.

const FALLBACK_COLOR: Color = [52 / 255, 120 / 255, 246 / 255]
const VALID_SHAPES = new Set<string>(SHAPES)
// 'straight' is the implicit default (absent field), so it's never stored —
// mirrors mutations.ts's rotation/scale/color idiom of clearing back to
// undefined at the default value (see domain/mutations.ts's setEdgeStyle).
const VALID_NON_DEFAULT_EDGE_STYLES = new Set<string>(EDGE_STYLES.filter((s) => s !== 'straight'))

// Invalid/missing/legacy -> undefined (meaning 'straight') — same
// drop-silently normalization idiom canonPoint uses for an unknown shape,
// just collapsing to "absent" instead of a concrete fallback value.
function canonEdgeStyle(raw: unknown): EdgeStyle | undefined {
  return typeof raw === 'string' && VALID_NON_DEFAULT_EDGE_STYLES.has(raw) ? (raw as EdgeStyle) : undefined
}

function asColor(c: unknown): Color {
  if (Array.isArray(c) && c.length === 3) return [Number(c[0]), Number(c[1]), Number(c[2])]
  return [...FALLBACK_COLOR]
}

function canonForm(f: Record<string, unknown>): Form {
  const pos = (f.position ?? {}) as { x?: unknown; y?: unknown }
  // Shim: prefer the new `shape` field; fall back to the legacy `kind` field
  // for diagrams saved before this rename (see the module-level comment above).
  const shape = (f.shape ?? f.kind) as Form['shape']
  const geom = geometryFor(shape)
  const rawEdges = (f.edges as Record<string, string[]>) ?? {}
  const edges: Record<string, string[]> = {}
  for (const k of geom.edgeKeys) {
    edges[k] = Array.isArray(rawEdges[k]) ? rawEdges[k] : []
  }
  return {
    id: String(f.id),
    shape,
    ...(f.name !== undefined ? { name: String(f.name) } : {}),
    ...(f.color != null ? { color: asColor(f.color) } : {}),
    ...(f.rotation != null ? { rotation: Number(f.rotation) } : {}),
    ...(f.scale != null && Number.isFinite(Number(f.scale)) && Number(f.scale) > 0
      ? { scale: Math.max(0.25, Math.min(4, Number(f.scale))) }
      : {}),
    position: { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0) },
    edges,
  }
}

function canonPoint(p: Record<string, unknown>): Point {
  // Legacy/unknown point shapes (the removed 'point'/'line'/'pentagon'/
  // 'hexagon', the old 'dot' alias, null, or anything else not in the
  // current 5-member Shape set) drop-silently normalize to 'empty' — the
  // create-default, no glyph. Valid shapes pass through unchanged.
  const shape: Shape = typeof p.shape === 'string' && VALID_SHAPES.has(p.shape) ? (p.shape as Shape) : 'empty'
  return {
    id: String(p.id),
    shape,
    ...(p.name !== undefined ? { name: String(p.name) } : {}),
    ...(p.color != null ? { color: asColor(p.color) } : {}),
    formId: String(p.formId),
    edgeKey: String(p.edgeKey),
  }
}

function canonLine(l: Record<string, unknown>): Line {
  return {
    id: String(l.id),
    ...(l.name !== undefined ? { name: String(l.name) } : {}),
    ...(l.color != null ? { color: asColor(l.color) } : {}),
    source: String(l.source),
    targets: Array.isArray(l.targets) ? l.targets.map(String) : [],
  }
}

// A raw point's own edgeKey matching the old vertex-key shape ('v0', 'v1',
// …) — the single robust signal that it was a CORNER point, regardless of
// whether it was filed under a form's old `corners` map or (older still)
// directly in `edges['v0']`.
const CORNER_KEY_RE = /^v\d+$/

// Strips the two removed shapes from RAW (pre-canon) form/point data — whole
// 'point'-shape forms, and corner points on any surviving form — BEFORE
// canonForm ever runs (canonForm calls geometryFor(shape), which would throw
// on the no-longer-registered 'point' shape). Returns the surviving raw
// forms/points plus the full set of dropped point ids, so restoreDiagram can
// prune Lines against that same set (mutations.ts's pruneLines) once
// everything else is canonicalized. Idempotent: a diagram with no corner
// points or 'point'-shape forms passes through with an empty removed set.
//
// This runs on RAW data, before canonForm's `f.shape ?? f.kind` shim ever
// applies — so the 'point'-shape check below must itself check BOTH
// spellings: an old save wrote `kind: 'point'`, a save written after this
// rename would write `shape: 'point'` (moot in practice, since 'point' is no
// longer offered anywhere in the UI, but the check stays symmetric with the
// canonForm shim rather than assuming which field an old save used).
function dropRemovedShapes(
  rawForms: Record<string, unknown>[], rawPoints: Record<string, unknown>,
): { forms: Record<string, unknown>[]; points: Record<string, unknown>; removedPointIds: Set<string> } {
  const removedPointIds = new Set<string>()

  const collectOwnedPointIds = (f: Record<string, unknown>) => {
    const edges = (f.edges as Record<string, string[]>) ?? {}
    for (const k of Object.keys(edges)) for (const pid of edges[k] ?? []) removedPointIds.add(String(pid))
    const corners = (f.corners as Record<string, string | undefined>) ?? {}
    for (const k of Object.keys(corners)) { const pid = corners[k]; if (pid) removedPointIds.add(String(pid)) }
  }

  const survivingForms: Record<string, unknown>[] = []
  for (const f of rawForms) {
    if (f.shape === 'point' || f.kind === 'point') { collectOwnedPointIds(f); continue } // whole form dropped
    // A surviving form's old `corners` map is dropped the same way — just
    // the points it names, not the form itself.
    const corners = (f.corners as Record<string, string | undefined>) ?? {}
    for (const k of Object.keys(corners)) { const pid = corners[k]; if (pid) removedPointIds.add(String(pid)) }
    survivingForms.push(f)
  }

  for (const k of Object.keys(rawPoints)) {
    const p = (rawPoints[k] ?? {}) as Record<string, unknown>
    if (typeof p.edgeKey === 'string' && CORNER_KEY_RE.test(p.edgeKey)) removedPointIds.add(k)
  }

  const survivingPoints: Record<string, unknown> = {}
  for (const k of Object.keys(rawPoints)) {
    if (!removedPointIds.has(k)) survivingPoints[k] = rawPoints[k]
  }

  return { forms: survivingForms, points: survivingPoints, removedPointIds }
}

// Old diagrams may carry an 'empty' form with several fanned points (from
// before forms.ts's emptyGeometry capped it at ONE middle point). Collapse
// them silently: keep the FIRST point id, re-point every Line that
// referenced a dropped one to it, and delete the dropped Point entries — no
// dangling ids, no visual line loss (every line still meets in the middle).
// Idempotent: a form already at <=1 point is untouched, so re-running this
// on an already-collapsed diagram (e.g. the next load) is a no-op.
function collapseEmptyForms(
  forms: Form[], points: Record<string, Point>, lines: Line[],
): { forms: Form[]; points: Record<string, Point>; lines: Line[] } {
  const remap = new Map<string, string>() // dropped point id -> kept point id
  let droppedForm = false
  const nextForms: Form[] = []
  for (const f of forms) {
    if (f.shape !== 'empty') { nextForms.push(f); continue }
    const edgeKey = geometryFor(f.shape).edgeKeys[0]
    const ids = f.edges[edgeKey] ?? []
    // An empty form IS its middle point — one without any point (a save
    // from before creation seeded it) is an invisible, connectionless
    // artifact: dropped outright, not seeded (no legacy support).
    if (ids.length === 0) { droppedForm = true; continue }
    if (ids.length === 1) { nextForms.push(f); continue }
    const [keep, ...drop] = ids
    for (const id of drop) remap.set(id, keep)
    nextForms.push({ ...f, edges: { ...f.edges, [edgeKey]: [keep] } })
  }
  if (remap.size === 0 && !droppedForm) return { forms, points, lines }
  if (remap.size === 0) return { forms: nextForms, points, lines }

  const nextPoints = { ...points }
  for (const id of remap.keys()) delete nextPoints[id]

  const rewrite = (id: string) => remap.get(id) ?? id
  const touchesRemap = (l: Line) => remap.has(l.source) || l.targets.some((t) => remap.has(t))
  const nextLines: Line[] = []
  for (const l of lines) {
    if (!touchesRemap(l)) { nextLines.push(l); continue }
    const source = rewrite(l.source)
    // Dedupe targets that collapsed onto the same kept id, then drop a
    // target that collapsed onto the LINE'S OWN source — a wire whose
    // source and only target both landed on the same middle point carries
    // no information; a line left with none is dropped entirely rather
    // than kept as a degenerate empty hyperedge.
    const targets = [...new Set(l.targets.map(rewrite))].filter((t) => t !== source)
    if (targets.length === 0) continue
    nextLines.push({ ...l, source, targets })
  }
  return { forms: nextForms, points: nextPoints, lines: nextLines }
}

// A caller may hand us the diagram as a JSON STRING rather than a parsed
// object — a `.json` import pasted as text, or an LLM MCP client that
// stringifies its `data` argument (create_diagram/update_diagram pass it
// straight through). Parse a string first so string and object inputs behave
// identically; an unparseable string yields null and falls through to the
// empty default below, exactly like any other non-object.
function parseIfString(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw
  try { return JSON.parse(raw) } catch { return null }
}

export function restoreDiagram(raw: unknown): Diagram {
  const src = parseIfString(raw)
  const d = (typeof src === 'object' && src !== null ? src : {}) as Record<string, unknown>
  const rawForms = Array.isArray(d.forms) ? (d.forms as Record<string, unknown>[]) : []
  const rawPoints = (d.points && typeof d.points === 'object' ? d.points : {}) as Record<string, unknown>
  const dropped = dropRemovedShapes(rawForms, rawPoints)

  const forms = dropped.forms.map((f) => canonForm(f as Record<string, unknown>))
  const points: Record<string, Point> = {}
  for (const k of Object.keys(dropped.points)) points[k] = canonPoint(dropped.points[k] as Record<string, unknown>)
  const rawLines = Array.isArray(d.lines) ? d.lines.map((l) => canonLine(l as Record<string, unknown>)) : []
  const lines = pruneLines(rawLines, dropped.removedPointIds)

  const collapsed = collapseEmptyForms(forms, points, lines)
  const edgeStyle = canonEdgeStyle(d.edgeStyle)
  return {
    schemaVersion: typeof d.schemaVersion === 'number' ? d.schemaVersion : 1,
    forms: collapsed.forms, points: collapsed.points, lines: collapsed.lines,
    ...(edgeStyle !== undefined ? { edgeStyle } : {}),
  }
}
