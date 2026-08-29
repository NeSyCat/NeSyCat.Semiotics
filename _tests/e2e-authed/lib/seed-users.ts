import { createClient } from '@supabase/supabase-js'
import { assertLocalHost } from './safety'

export interface SeededUser {
  email: string
  password: string
  userId: string
}

// Creates ONE brand-new, confirmed user via the local stack's admin API
// (service-role key — never available to, or usable by, the app itself).
// Every setup.ts run mints fresh random-suffixed emails (see scripts/
// setup.ts) rather than reusing fixed ones, so bootstrap.spec.ts's "first
// login" assertion is true every single run, not just the first time this
// script is ever executed against a given local Postgres volume.
export async function seedUser(
  apiUrl: string,
  serviceRoleKey: string,
  email: string,
  password: string,
): Promise<SeededUser> {
  assertLocalHost(apiUrl, 'seed-users API URL')
  const admin = createClient(apiUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true, // local config has enable_confirmations = false anyway; explicit for clarity
  })
  if (error || !data.user) {
    throw new Error(`admin.createUser(${email}) failed: ${error?.message ?? 'no user returned'}`)
  }
  return { email, password, userId: data.user.id }
}
