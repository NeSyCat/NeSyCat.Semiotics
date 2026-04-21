import { createBrowserClient } from '@supabase/ssr'

// Browser client: server-side /auth/callback handles the PKCE exchange.
// Disabling detectSessionInUrl prevents the browser from racing the server
// and consuming the ?code=… first (which caused bad_code_verifier 400s).
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { detectSessionInUrl: false, flowType: 'pkce' } },
  )
