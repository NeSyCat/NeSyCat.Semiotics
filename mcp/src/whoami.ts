#!/usr/bin/env node
// `npm run whoami` — CLI counterpart of the `whoami` MCP tool (tools/whoami.ts),
// for a quick "am I logged in" check without going through an MCP host.
import { getSupabaseClient } from './supabase/client.js'

async function main() {
  const client = getSupabaseClient()
  const { data, error } = await client.auth.getUser()
  if (error || !data.user) {
    console.log('Not logged in — run `npm run login`.')
    return
  }
  console.log(`Logged in as ${data.user.email ?? '(no email)'} (id: ${data.user.id})`)
}

await main()
