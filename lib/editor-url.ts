// Pure host/URL logic — no `next/headers`, safe to import from client
// components. Server-only wrappers that need request headers live in
// `lib/editor-url.server.ts`.

export const EDITOR_SUBDOMAIN = 'semiotics.nesycat.org'
export const COOKIE_DOMAIN = '.nesycat.org'

type Mode = 'subdomain' | 'apex' | 'single-host'

function modeForHost(host: string): Mode {
  if (host === EDITOR_SUBDOMAIN) return 'subdomain'
  if (host === 'nesycat.org' || host === 'www.nesycat.org') return 'apex'
  return 'single-host'
}

export function editorHrefForHost(host: string, id?: string): string {
  const mode = modeForHost(host)
  if (mode === 'subdomain') return id ? `/${id}` : '/'
  if (mode === 'apex') return id ? `https://${EDITOR_SUBDOMAIN}/${id}` : `https://${EDITOR_SUBDOMAIN}/`
  return id ? `/editor/${id}` : '/editor'
}

export function callbackUrlForHost(host: string): string {
  if (modeForHost(host) === 'apex') return `https://${EDITOR_SUBDOMAIN}/auth/callback`
  return `/auth/callback`
}

// Shared by app/auth/callback/route.ts and lib/supabase/proxy.ts — both need
// to know whether the request host is one of the nesycat.org hosts that
// should get the shared, apex-scoped session cookie.
export function isNesycatHost(host: string): boolean {
  return host === 'nesycat.org' || host === 'www.nesycat.org' || host === EDITOR_SUBDOMAIN
}

// Client-safe equivalent of serverEditorHref() — reads window.location.host
// directly instead of going through next/headers. For use in 'use client'
// components (e.g. EditorSidebar) that navigate between diagrams.
export function clientEditorHref(id?: string): string {
  if (typeof window === 'undefined') return id ? `/editor/${id}` : '/editor'
  return editorHrefForHost(window.location.host, id)
}

export function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}
