import type { Diagram, Form, Point, Line, Color, PointShape } from './types'
import { geometryFor } from './forms'

// Single load-boundary normalizer. Persisted JSON arrives from Supabase
// (`diagrams.data` jsonb) or a JSON import; this fills defaults and rebuilds
// each record in canonical field order (Postgres JSONB reorders object keys on
// insert, so we re-canonicalize to keep autosave's JSON dedupe stable).
//
// Diagrams saved under the OLD editor model ({nodes, edges}) have no
// forms/points/lines, so they restore as an empty diagram — expected for the
// from-scratch rebuild.

const FALLBACK_COLOR: Color = [52 / 255, 120 / 255, 246 / 255]

function asColor(c: unknown): Color {
  if (Array.isArray(c) && c.length === 3) return [Number(c[0]), Number(c[1]), Number(c[2])]
  return [...FALLBACK_COLOR]
}

function canonForm(f: Record<string, unknown>): Form {
  const pos = (f.position ?? {}) as { x?: unknown; y?: unknown }
  const kind = f.kind as Form['kind']
  const geom = geometryFor(kind)
  const rawEdges = (f.edges as Record<string, string[]>) ?? {}
  const rawCorners = (f.corners as Record<string, string | undefined>) ?? {}
  const edges: Record<string, string[]> = {}
  const corners: Record<string, string | undefined> = {}
  for (const k of geom.edgeKeys) {
    if (k in geom.corners) {
      // Corners moved from `edges` (an array) to their own single-slot
      // `corners` map. Migrate old data by keeping just the first point —
      // a corner was never meant to hold more than one.
      corners[k] = rawCorners[k] ?? (Array.isArray(rawEdges[k]) ? rawEdges[k][0] : undefined)
    } else {
      edges[k] = Array.isArray(rawEdges[k]) ? rawEdges[k] : []
    }
  }
  return {
    id: String(f.id),
    kind,
    ...(f.name !== undefined ? { name: String(f.name) } : {}),
    ...(f.color != null ? { color: asColor(f.color) } : {}),
    ...(f.rotation != null ? { rotation: Number(f.rotation) } : {}),
    ...(f.scale != null && Number.isFinite(Number(f.scale)) && Number(f.scale) > 0
      ? { scale: Math.max(0.25, Math.min(4, Number(f.scale))) }
      : {}),
    position: { x: Number(pos.x ?? 0), y: Number(pos.y ?? 0) },
    edges,
    corners,
  }
}

function canonPoint(p: Record<string, unknown>): Point {
  return {
    id: String(p.id),
    shape: p.shape == null || p.shape === 'dot' ? 'point' : (p.shape as PointShape),
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

export function restoreDiagram(raw: unknown): Diagram {
  const d = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const forms = Array.isArray(d.forms) ? d.forms.map((f) => canonForm(f as Record<string, unknown>)) : []
  const pointsRaw = (d.points && typeof d.points === 'object' ? d.points : {}) as Record<string, unknown>
  const points: Record<string, Point> = {}
  for (const k of Object.keys(pointsRaw)) points[k] = canonPoint(pointsRaw[k] as Record<string, unknown>)
  const lines = Array.isArray(d.lines) ? d.lines.map((l) => canonLine(l as Record<string, unknown>)) : []
  return { schemaVersion: typeof d.schemaVersion === 'number' ? d.schemaVersion : 1, forms, points, lines }
}
