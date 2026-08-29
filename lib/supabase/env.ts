// Whether the Supabase env pair is present. When it is ABSENT (a CI runner,
// or a fresh checkout with no .env.local), the app degrades to fully-
// anonymous mode instead of crashing: the middleware skips session refresh
// (lib/supabase/proxy.ts) and /editor renders the AnonymousEditor sandbox
// (app/editor/page.tsx) — the same graceful-degrade pattern as the optional
// Brevo invite emails (lib/email.ts). Auth-only routes (sign-in, /editor/[id])
// remain meaningless without Supabase and are not guarded here.
//
// Deliberately a module with NO other imports: proxy.ts runs in the
// middleware runtime and must not transitively pull in next/headers (which
// lib/supabase/server.ts imports).
export function supabaseConfigured(): boolean {
  return !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
}
