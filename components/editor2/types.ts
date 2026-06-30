// NeSyCat Semiotics — editor2 domain model.
//
// Deliberately SIMPLE and NON-RECURSIVE. There are two distinct types:
//   • Form  — a "big shape" (triangle / square / circle). Has its own shape
//             (kind) and edges; each edge holds an ORDERED LIST of points.
//   • Point — a separate, leaf type. A point also HAS a shape (its own small
//             glyph), but it is differentiated from a form: it sits on a
//             form's edge, can be wired by lines, and contains NOTHING.
// Lines connect points. No nesting, no recursion anywhere.

export type Color = [number, number, number] // normalized RGB, each in [0,1]

// ── Forms (the big shapes) ───────────────────────────────────────────
export type FormKind = 'triangle' | 'square' | 'circle' | 'rhombus' | 'empty'
// Functional in Phase 1; the rest render as a placeholder body.
export const PRIORITY_KINDS = ['triangle', 'square', 'circle'] as const

// An edge key names one side/arc of a form. Validated per-kind by the form
// registry (forms.ts):
//   triangle: 'a' | 'b' | 'c'
//   square:   'top' | 'right' | 'bottom' | 'left'
//   circle:   'ne' | 'se' | 'sw' | 'nw'
export type EdgeKey = string

export interface Form {
  id: string
  kind: FormKind
  name?: string
  color: Color
  position: { x: number; y: number }
  // edgeKey -> ordered list of POINT ids sitting on that edge.
  edges: Record<EdgeKey, string[]>
}

// ── Points (leaves; distinct from forms) ─────────────────────────────
// A point's shape is drawn from the SAME vocabulary as the Spine's Shape rail,
// just rendered small. 'point' (a filled dot) is the default.
export type PointShape =
  | 'empty'
  | 'point'
  | 'line'
  | 'triangle'
  | 'rhombus'
  | 'pentagon'
  | 'hexagon'
  | 'circle'
  | 'square'

export interface Point {
  id: string
  shape: PointShape // the point's own (small) shape; default 'empty' (no glyph)
  name?: string
  color: Color
  formId: string // the Form this point sits on
  edgeKey: EdgeKey // which edge of that form
  // No edges, no children — a point is a leaf.
}

// ── Lines (connections between points) ───────────────────────────────
export interface Line {
  id: string
  name?: string
  color: Color
  source: string // point id
  targets: string[] // 1+ point ids (hyperedge)
}

// ── Diagram (flat registries; persisted to the `diagrams.data` jsonb) ─
export interface Diagram {
  schemaVersion: number
  forms: Form[] // top-level big shapes (React Flow nodes)
  points: Record<string, Point> // every point, flat (each sits on one form edge)
  lines: Line[] // connections (React Flow edges)
}
