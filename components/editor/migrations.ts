import type { Diagram } from './types'

// Each migration transforms a doc at version `from` into a doc at version `from + 1`.
// The `up` function takes `any` by design — pre-migration shapes aren't stable types.
type Migration = { from: number; up: (doc: any) => any }

const migrations: Migration[] = []

const defaults: Diagram = {
  schemaVersion: 1,
  nodes: [],
  edges: [],
}

function migrate(raw: any): any {
  let doc = raw ?? {}
  for (const m of migrations) {
    if (doc.schemaVersion === m.from) doc = m.up(doc)
  }
  return doc
}

// Single-entry normalizer — call at every load boundary (Supabase fetch, JSON import,
// sample file loader). Never feed raw persisted data directly to the store.
//
// Pattern: defaults spread first, migrated doc on top. Fields in migrated win;
// fields only in defaults fill missing keys (backward-compat); fields only in
// migrated are preserved (forward-compat — a newer app's extra fields round-trip
// safely through an older app).
export function restoreDiagram(raw: unknown): Diagram {
  const input = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  const versioned = { schemaVersion: 1, ...input }
  const migrated = migrate(versioned)
  return { ...defaults, ...migrated }
}
