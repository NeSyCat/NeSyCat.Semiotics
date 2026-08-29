import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { cache } from 'react'
import type { User } from '@supabase/supabase-js'

export const createClient = async () => {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) => {
          try {
            list.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            )
          } catch {
            // Server Component — cookies read-only; proxy refreshes on next request.
          }
        },
      },
    },
  )
}

// Request-scoped memoization of the auth.getUser() round trip: the editor
// layout and its page both need the current user before doing anything else,
// and both run in the same render pass on every fresh navigation (this is a
// full route tree, not a client-side transition). Wrapped in React's cache()
// so only the first caller in a given request hits Supabase; every other
// caller in the same render gets the memoized result. Callers still gate
// this behind supabaseConfigured() themselves (see lib/supabase/env.ts) —
// this helper doesn't duplicate that guard.
export const getAuthUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient()
  return (await supabase.auth.getUser()).data.user
})
