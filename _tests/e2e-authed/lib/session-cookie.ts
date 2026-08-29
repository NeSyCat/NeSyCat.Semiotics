import type { BrowserContext } from '@playwright/test'
import type { Session } from '@supabase/supabase-js'

// ─────────────────────────────────────────────────────────────────────────
// How this cookie name/format was derived (read this before touching it):
//
// The app is OAuth-only (GitHub via signInWithOAuth — see lib/auth.ts,
// app/auth/callback/route.ts). There is no password sign-in UI to drive, so
// this lane signs in programmatically with @supabase/supabase-js's
// signInWithPassword against the LOCAL stack, then hand-builds the exact
// cookie(s) @supabase/ssr's createServerClient (lib/supabase/server.ts,
// lib/supabase/proxy.ts) and createBrowserClient (lib/supabase/client.ts)
// expect to find, and injects them via BrowserContext.addCookies() before
// the first navigation. Every detail below was read out of the installed
// package versions in node_modules, not guessed:
//
// 1. COOKIE NAME — `sb-<ref>-auth-token`.
//    Neither lib/supabase/client.ts nor server.ts/proxy.ts pass a
//    `cookieOptions.name`, so @supabase/ssr falls through to supabase-js's
//    own default `storageKey`. That default is computed in
//    node_modules/@supabase/supabase-js/dist/umd/supabase.js as:
//      `sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`
//    For the local stack's API URL (http://127.0.0.1:54321), hostname
//    "127.0.0.1".split('.')[0] is "127" — so the cookie is `sb-127-auth-token`
//    (a well-known Supabase-local-dev quirk, not a bug in this derivation).
//    computeStorageKey() below reproduces exactly this.
//
// 2. COOKIE VALUE — `base64-` + base64url(JSON.stringify(session)).
//    Neither client sets `cookieEncoding`, so @supabase/ssr's
//    createStorageFromOptions (node_modules/@supabase/ssr/dist/main/
//    cookies.js) defaults `cookieEncoding` to "base64url" in BOTH
//    createBrowserClient.js and createServerClient.js. Its setItem writes
//    `BASE64_PREFIX + stringToBase64URL(value)` where `value` is
//    `JSON.stringify(session)` (the GoTrueClient session object — literally
//    what signInWithPassword's `data.session` already is: access_token,
//    refresh_token, expires_at, user, …) and `BASE64_PREFIX = "base64-"`.
//    getItem does the mirror-image decode, so this is exactly what the
//    server middleware's `supabase.auth.getUser()` call expects to read.
//
// 3. CHUNKING — @supabase/ssr splits a cookie into `name`, `name.0`,
//    `name.1`, … once `encodeURIComponent(value).length` exceeds
//    MAX_CHUNK_SIZE = 3180 (node_modules/@supabase/ssr/dist/main/utils/
//    chunker.js). A base64url string plus our literal "base64-" prefix
//    uses only characters already outside encodeURIComponent's escape set
//    (A-Z a-z 0-9 - _ and the plain "-"), so `encodeURIComponent(value) ===
//    value` for us — meaning splitting on raw length is exactly equivalent
//    to the library's own encoded-length check, with none of its
//    UTF-8-boundary-safety logic needed (that logic exists for the general
//    case of arbitrary — potentially non-ASCII — cookie values, which a
//    base64url string can never be). buildSessionCookies() below relies on
//    this to keep the chunking trivial and still be exactly correct.
//
// 4. COOKIE ATTRIBUTES — path "/", sameSite "lax", httpOnly false, maxAge
//    400 days, per @supabase/ssr's DEFAULT_COOKIE_OPTIONS (utils/
//    constants.js) — neither client overrides these. `domain` is left
//    unset by the app in dev (lib/supabase/client.ts's sharedCookieDomain()
//    only returns a domain on a *.nesycat.org host), so the cookie is
//    plain first-party against whatever host serves the app — here,
//    localhost:<authed port>, not the Supabase API host.
// ─────────────────────────────────────────────────────────────────────────

const BASE64_PREFIX = 'base64-'
const MAX_CHUNK_SIZE = 3180 // @supabase/ssr's utils/chunker.js MAX_CHUNK_SIZE

export function computeStorageKey(supabaseUrl: string): string {
  const ref = new URL(supabaseUrl).hostname.split('.')[0]
  return `sb-${ref}-auth-token`
}

export interface BuiltCookie {
  name: string
  value: string
}

// See point 3 above for why plain-length chunking is exact here, not an
// approximation of the library's own (UTF-8-safety-oriented) algorithm.
export function buildSessionCookies(supabaseUrl: string, session: Session): BuiltCookie[] {
  const name = computeStorageKey(supabaseUrl)
  const raw = BASE64_PREFIX + Buffer.from(JSON.stringify(session), 'utf-8').toString('base64url')
  if (raw.length <= MAX_CHUNK_SIZE) return [{ name, value: raw }]
  const chunks: BuiltCookie[] = []
  for (let i = 0, idx = 0; i < raw.length; i += MAX_CHUNK_SIZE, idx += 1) {
    chunks.push({ name: `${name}.${idx}`, value: raw.slice(i, i + MAX_CHUNK_SIZE) })
  }
  return chunks
}

// Injects the session as first-party cookies against `appOrigin` (the
// authed webServer's own origin, e.g. http://localhost:3220) — deliberately
// NOT the Supabase API origin; the app reads these via the browser's own
// document.cookie / the Next.js middleware's request cookies, same as a
// real sign-in would have written them.
export async function injectSupabaseSession(
  context: BrowserContext,
  opts: { supabaseUrl: string; session: Session; appOrigin: string },
): Promise<void> {
  const { hostname } = new URL(opts.appOrigin)
  const expires = Math.floor(Date.now() / 1000) + 400 * 24 * 60 * 60 // DEFAULT_COOKIE_OPTIONS.maxAge
  const cookies = buildSessionCookies(opts.supabaseUrl, opts.session)
  await context.addCookies(
    cookies.map(({ name, value }) => ({
      name,
      value,
      domain: hostname,
      path: '/',
      httpOnly: false,
      secure: false, // http://localhost in dev — a Secure cookie would be silently dropped
      sameSite: 'Lax' as const,
      expires,
    })),
  )
}
