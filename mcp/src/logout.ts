#!/usr/bin/env node
// `npm run logout` — signs out (best-effort, revokes the refresh token
// server-side) and deletes mcp/.session.json outright, a clean slate rather
// than relying on signOut()'s own storage.removeItem calls.
import { getSupabaseClient, SESSION_PATH } from './supabase/client.js'
import { deleteSessionFile } from './supabase/session-storage.js'

async function main() {
  const client = getSupabaseClient()
  const { error } = await client.auth.signOut()
  if (error) console.warn('signOut() reported an error (continuing to clear the local session anyway):', error.message)
  deleteSessionFile(SESSION_PATH)
  console.log('Logged out — mcp/.session.json removed.')
}

await main()
