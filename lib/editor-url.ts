import { headers } from 'next/headers'

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

export async function serverEditorHref(id?: string): Promise<string> {
  const h = await headers()
  return editorHrefForHost(h.get('host') ?? '', id)
}

export async function serverCallbackUrl(): Promise<string> {
  const h = await headers()
  return callbackUrlForHost(h.get('host') ?? '')
}

export function landingHrefForHost(host: string): string {
  if (modeForHost(host) === 'subdomain') return 'https://www.nesycat.org/'
  return '/'
}

export async function serverLandingHref(): Promise<string> {
  const h = await headers()
  return landingHrefForHost(h.get('host') ?? '')
}

export async function isSubdomainHost(): Promise<boolean> {
  const h = await headers()
  return (h.get('host') ?? '') === EDITOR_SUBDOMAIN
}

export function isProd(): boolean {
  return process.env.NODE_ENV === 'production'
}
