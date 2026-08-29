'use client'

import type { createClient } from '@/lib/supabase/client'

// Pushes the CURRENT session's access token onto the Realtime websocket
// before a channel subscribes. Without this, this app's Realtime socket
// authenticates as `anon` and RLS silently drops every postgres_changes
// event the user is entitled to — subscriptions "work" (no error) but never
// deliver anything.
//
// Why supabase-js doesn't do it by itself here: the library only calls
// `realtime.setAuth()` on the SIGNED_IN and TOKEN_REFRESHED auth events
// (verified in @supabase/supabase-js 2.104's _handleTokenChanged). This app
// completes its OAuth PKCE exchange SERVER-side (app/auth/callback/route.ts;
// the browser client runs with detectSessionInUrl: false), so the browser
// client never fires SIGNED_IN at all — every page load hydrates the session
// from cookies and fires only INITIAL_SESSION, which the library ignores for
// Realtime auth. The socket would stay anonymous until the first automatic
// token refresh (~55 minutes in). Found by the authed e2e lane: DB writes
// succeeded, events verifiably left Postgres, and the subscribed browser
// received nothing.
//
// Safe to call unconditionally before every subscribe: with no session it
// does nothing (the socket stays anon, correct for that state), and later
// refreshes keep being handled by the library's own TOKEN_REFRESHED path.
export async function ensureRealtimeAuth(supabase: ReturnType<typeof createClient>): Promise<void> {
  try {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.access_token) {
      supabase.realtime.setAuth(session.access_token)
      console.debug('ensureRealtimeAuth: token set on realtime socket')
    } else {
      console.debug('ensureRealtimeAuth: no browser session — socket stays anon')
    }
  } catch (err) {
    console.error('ensureRealtimeAuth: could not read session for realtime auth', err)
  }
}
