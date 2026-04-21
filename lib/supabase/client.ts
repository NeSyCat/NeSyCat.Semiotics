import { createBrowserClient } from '@supabase/ssr'

function sharedCookieDomain(): string | undefined {
  if (typeof window === 'undefined') return undefined
  const host = window.location.hostname
  if (host === 'nesycat.com' || host.endsWith('.nesycat.com')) {
    return '.nesycat.com'
  }
  return undefined
}

// Browser client: server-side /auth/callback handles the PKCE exchange.
// Disabling detectSessionInUrl prevents the browser from racing the server
// and consuming the ?code=… first (which caused bad_code_verifier 400s).
//
// cookieOptions.domain: in production we store session + PKCE verifier
// cookies with Domain=.nesycat.com so the verifier set on www.nesycat.com
// (where sign-in is clicked) is readable by the callback on
// semiotics.nesycat.com (where OAuth lands).
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: { detectSessionInUrl: false, flowType: 'pkce' },
      cookieOptions: { domain: sharedCookieDomain() },
    },
  )
