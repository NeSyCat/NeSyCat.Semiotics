// VENDORED COPY — verbatim from `domain/types.ts` (repo root), NOT a live relative
// import. The app root has no "type":"module" in its package.json, so when
// this mcp package (own package.json has "type":"module") tries to
// cross-import these files by relative path at runtime, Node's ESM loader
// resolves THEIR module format by walking up from their own location (the
// app root, CommonJS) rather than from mcp/ — the resulting CJS transpile
// of a .ts file loaded via tsx is then subject to cjs-module-lexer's static
// named-export detection, which is unreliable across these files (confirmed
// empirically: some named imports resolved, others silently came back
// undefined). Copying the file into mcp/'s own ESM module graph sidesteps
// that boundary entirely — this is a byte-for-byte copy of the logic below
// (see the one documented exception in domain/forms.ts), not a
// reimplementation. Keep in sync by hand if the source file changes.

// NeSyCat Semiotics — editor domain model.
//
// Deliberately SIMPLE and NON-RECURSIVE. There are two distinct types:
//   • Form  — a "big shape" (triangle / square / circle). Has its own shape
//             and sides (each an ORDERED LIST of points — a wire run can
//             take any number).
//   • Point — a separate, leaf type. A point also HAS a shape (its own small
//             glyph), but it is differentiated from a form: it sits on a
//             form's edge, can be wired by lines, and contains NOTHING.
// Lines connect points. No nesting, no recursion anywhere.

export type Color = [number, number, number] // normalized RGB, each in [0,1]

// ── Shapes — the ONE vocabulary shared by a Form's own shape and a Point's
// (small) glyph. There is no separate FormShape/PointShape split: a Form and
// a Point simply pick from the same 5-member set.
export type Shape = 'triangle' | 'square' | 'circle' | 'rhombus' | 'empty'
// Have real edges that points can attach to; 'empty' renders as an edgeless placeholder body.

// An edge key names one side/arc of a form. Validated per-shape by the form
// registry (forms.ts):
//   triangle: 'a' | 'b' | 'c'
//   square:   'top' | 'right' | 'bottom' | 'left'
//   circle:   'ne' | 'se' | 'sw' | 'nw'
export type EdgeKey = string

export interface Form {
  id: string
  shape: Shape
  name?: string
  color?: Color // undefined = no colour (the default)
  rotation?: number // degrees, 0-359; undefined = 0 (no rotation)
  scale?: number // size multiplier, 0.25-4; undefined = 1 (no scaling)
  position: { x: number; y: number }
  // Side keys -> ordered list of point ids (unbounded — a side is a wire run).
  edges: Record<EdgeKey, string[]>
}

// ── Points (leaves; distinct from forms) ─────────────────────────────
// A point's shape is drawn from the SAME vocabulary as a Form's own shape
// (Shape, above), just rendered small.

export interface Point {
  id: string
  shape: Shape // the point's own (small) shape; default 'empty' (no glyph)
  name?: string
  color?: Color // undefined = no colour (the default)
  formId: string // the Form this point sits on
  edgeKey: EdgeKey // which edge of that form
  // No edges, no children — a point is a leaf.
}

// ── Lines (connections between points) ───────────────────────────────
export interface Line {
  id: string
  name?: string
  color?: Color // undefined = no colour (the default)
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
