// A file-backed implementation of supabase-js's `SupportedStorage` interface
// (getItem/setItem/removeItem, each string-keyed/valued), so `createClient`'s
// `auth.storage` option persists the signed-in session to a JSON file on
// disk instead of the browser localStorage it defaults to — there is no
// browser here, just `login`/`whoami`/`logout`/`start`, all separate CLI
// invocations that need to share one saved session between runs.
//
// One JSON object on disk, `{ [key]: value }`, holding whatever string keys
// supabase-js's GoTrueClient itself chooses to write (its own session token
// under some internal key) — this adapter doesn't know or care what those
// keys are, matching how localStorage is also just an opaque string map from
// GoTrueClient's point of view.
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

export interface FileStorage {
  getItem(key: string): Promise<string | null>
  setItem(key: string, value: string): Promise<void>
  removeItem(key: string): Promise<void>
}

type Store = Record<string, string>

function readStore(path: string): Store {
  if (!existsSync(path)) return {}
  try {
    const raw = readFileSync(path, 'utf8')
    if (!raw.trim()) return {}
    const parsed = JSON.parse(raw) as unknown
    return parsed && typeof parsed === 'object' ? (parsed as Store) : {}
  } catch {
    // A corrupt/partial session file is treated as "no session" rather than
    // crashing every tool call — the user just needs to `npm run login` again.
    return {}
  }
}

function writeStore(path: string, store: Store): void {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(store, null, 2), 'utf8')
}

export function createFileStorage(path: string): FileStorage {
  return {
    async getItem(key) {
      return readStore(path)[key] ?? null
    },
    async setItem(key, value) {
      const store = readStore(path)
      store[key] = value
      writeStore(path, store)
    },
    async removeItem(key) {
      const store = readStore(path)
      if (!(key in store)) return
      delete store[key]
      writeStore(path, store)
    },
  }
}

// Deletes the whole session file (used by `logout` for a clean slate,
// distinct from removeItem which only clears one key).
export function deleteSessionFile(path: string): void {
  if (existsSync(path)) rmSync(path)
}
