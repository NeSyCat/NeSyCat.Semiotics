// Supabase client for this MCP server — authenticated AS the signed-in user,
// never bypassing RLS. Two things distinguish this from a typical server-side
// client: (1) the anon key only (no service-role key, no direct Postgres
// connection anywhere in this package — see ../../README.md), and (2) session
// storage is a file (session-storage.ts) instead of a browser/cookie jar, so
// `login` (this process), and later `whoami`/`start` (separate process
// invocations), all see the same signed-in session.
import { createClient as createSupabaseClient, type SupabaseClient } from '@supabase/supabase-js'
import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createFileStorage } from './session-storage.js'

const MCP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
export const ENV_PATH = path.join(MCP_ROOT, '.env')
export const SESSION_PATH = path.join(MCP_ROOT, '.session.json')

// Claude Code (or any MCP host) spawns this server with an unpredictable
// cwd — resolve `.env` relative to THIS file, not dotenv's cwd-relative
// default (same reasoning as the Admination reference's db.ts).
if (existsSync(ENV_PATH)) loadDotenv({ path: ENV_PATH })

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    throw new Error(`${name} is not set — copy mcp/.env.example to mcp/.env and fill it in (see mcp/README.md)`)
  }
  return value
}

let cached: SupabaseClient | undefined

// Lazy singleton: constructing a supabase-js client does no network I/O by
// itself (it only configures fetch/storage), but keeping it lazy means
// importing this module — e.g. transitively, from a test — never requires
// SUPABASE_URL/SUPABASE_ANON_KEY to be set.
export function getSupabaseClient(): SupabaseClient {
  if (cached) return cached
  const url = requireEnv('SUPABASE_URL')
  const anonKey = requireEnv('SUPABASE_ANON_KEY')
  cached = createSupabaseClient(url, anonKey, {
    auth: {
      flowType: 'pkce',
      persistSession: true,
      autoRefreshToken: true,
      storage: createFileStorage(SESSION_PATH),
    },
  })
  return cached
}

export function loginPort(): number {
  const raw = process.env.SEMIOTICS_LOGIN_PORT
  const port = raw ? Number(raw) : 8976
  return Number.isFinite(port) && port > 0 ? port : 8976
}

export function defaultOrgEnv(): string | undefined {
  const v = process.env.SEMIOTICS_DEFAULT_ORG
  return v && v.trim() ? v.trim() : undefined
}
