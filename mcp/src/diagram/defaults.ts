import type { Diagram } from '../vendor/editor/domain/types.js'

// The editor's own empty-diagram shape (persist/io.ts's restoreDiagram
// produces exactly this for any unrecognized/absent input) — used as
// create_diagram's default `data` when the caller omits one.
export function emptyDiagram(): Diagram {
  return { schemaVersion: 1, forms: [], points: {}, lines: [] }
}
