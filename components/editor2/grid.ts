// NeSyCat Semiotics — snap-to-grid geometry. Pure helpers shared by
// Canvas.tsx (live drag / double-click creation / drag-stop persistence) and
// tikz.ts's test script, so there is exactly one definition of "what
// grid-snapped means" — no separate reimplementation drifting out of sync.
//
// Grid pitch: 50px in flow coordinates. Chosen to pair with the TikZ
// exporter's 100px = 1cm mapping (tikz.ts) — one grid cell is 0.5cm, so a
// grid-snapped diagram exports with clean 0.5cm-multiple coordinates.
//
// Grid/snap ON-OFF state itself is transient UI state (store.ts's
// `gridEnabled`) — NOT part of the Diagram schema (types.ts) or the DB. This
// module only holds the pure math; whether it's applied is decided at the
// Canvas.tsx call sites.

import { geometryFor } from './forms'
import type { Form } from './types'

export const GRID_SIZE = 50

// Nearest grid line to a single flow-px coordinate.
export function snapCoord(v: number): number {
  return Math.round(v / GRID_SIZE) * GRID_SIZE
}

export function snapPoint(p: { x: number; y: number }): { x: number; y: number } {
  return { x: snapCoord(p.x), y: snapCoord(p.y) }
}

// The subset of Form that nodeSize() actually reads (forms.ts): every kind's
// nodeSize looks only at .kind (via geometryFor) and .edges (point counts
// per side, for the ROW_HEIGHT growth); 'empty' ignores edges' contents
// entirely. A form-shaped object missing id/position (e.g. one that doesn't
// exist yet, mid double-click creation) is a valid input here.
export type SizableForm = Pick<Form, 'kind' | 'scale' | 'edges'>

// Snaps a form's CENTER — position + n/2, per FormNode.tsx's own n and
// FormNode's rendering (n = geometryFor(kind).nodeSize(form) * (scale ?? 1))
// — to the nearest grid intersection, returning the corresponding top-left
// `position`. A form is stored/positioned by its top-left corner, but node
// size varies per kind/scale/point-count, so the top-left itself is a moving
// target; the center is the one stable thing that visually lands on a grid
// dot, quiver-style.
export function snapCenterPosition(form: SizableForm, position: { x: number; y: number }): { x: number; y: number } {
  const n = geometryFor(form.kind).nodeSize(form as Form) * (form.scale ?? 1)
  const center = snapPoint({ x: position.x + n / 2, y: position.y + n / 2 })
  return { x: center.x - n / 2, y: center.y - n / 2 }
}
