// The one job this whole module has: make it structurally hard for any
// script in this lane to ever run schema DDL, seed a user, or point the app
// at anything other than the LOCAL Supabase stack. Every connection string
// / API URL this lane is about to *use* (not just read) is expected to pass
// through assertLocalHost() first — see bootstrap-db.ts, seed-users.ts, and
// scripts/setup.ts.
const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '::1'])

export function assertLocalHost(url: string, label: string): void {
  let hostname: string
  try {
    hostname = new URL(url).hostname
  } catch (err) {
    throw new Error(`${label} is not a valid URL (${String(err)}): ${redact(url)}`)
  }
  if (!LOCAL_HOSTS.has(hostname)) {
    throw new Error(
      `Refusing to use ${label} — its host ("${hostname}") is not localhost/127.0.0.1. ` +
        `This lane must only ever talk to the LOCAL Supabase stack; ${redact(url)} looks ` +
        `like it could be the remote/production project from .env.local. Aborting.`,
    )
  }
}

// For error messages only — never log a full connection string or API key.
function redact(url: string): string {
  try {
    const u = new URL(url)
    u.password = u.password ? '***' : u.password
    u.search = u.search ? '?***' : u.search
    return u.toString()
  } catch {
    return '(unparsable value, not shown)'
  }
}
