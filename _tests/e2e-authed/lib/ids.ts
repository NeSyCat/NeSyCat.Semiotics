// Diagram ids are UUIDs baked into the /editor/<id> route
// (app/editor/[id]/page.tsx) — shared tiny helper for specs that need to
// compare "which diagram is currently open" across pages/contexts.
const DIAGRAM_ID_RE = /\/editor\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i

export function diagramIdFromUrl(urlOrPath: string): string | null {
  return urlOrPath.match(DIAGRAM_ID_RE)?.[1] ?? null
}
