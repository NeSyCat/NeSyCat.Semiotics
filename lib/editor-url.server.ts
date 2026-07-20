// Server-only wrappers around lib/editor-url.ts's pure functions — these read
// the incoming request's Host header via next/headers, which is not
// importable from client components.

import { headers } from 'next/headers'
import { EDITOR_SUBDOMAIN, callbackUrlForHost, editorHrefForHost } from '@/lib/editor-url'

export async function serverEditorHref(id?: string): Promise<string> {
  const h = await headers()
  return editorHrefForHost(h.get('host') ?? '', id)
}

export async function serverCallbackUrl(): Promise<string> {
  const h = await headers()
  return callbackUrlForHost(h.get('host') ?? '')
}

export async function isSubdomainHost(): Promise<boolean> {
  const h = await headers()
  return (h.get('host') ?? '') === EDITOR_SUBDOMAIN
}
