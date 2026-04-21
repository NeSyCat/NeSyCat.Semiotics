import { NextResponse, type NextRequest } from 'next/server'
import { updateSession } from '@/lib/supabase/proxy'
import { EDITOR_SUBDOMAIN } from '@/lib/editor-url'

const APEX_HOSTS = new Set(['nesycat.com', 'www.nesycat.com'])

export async function proxy(request: NextRequest) {
  const host = request.headers.get('host') ?? ''
  const { pathname, search } = request.nextUrl

  if (APEX_HOSTS.has(host) && pathname.startsWith('/editor')) {
    const rest = pathname === '/editor' ? '/' : pathname.slice('/editor'.length)
    return NextResponse.redirect(`https://${EDITOR_SUBDOMAIN}${rest}${search}`, 308)
  }

  let rewriteTo: URL | null = null

  if (host === EDITOR_SUBDOMAIN) {
    const passthrough =
      pathname.startsWith('/editor') ||
      pathname.startsWith('/auth') ||
      pathname.startsWith('/api') ||
      pathname.startsWith('/_next') ||
      pathname.startsWith('/embed')

    if (!passthrough) {
      const url = request.nextUrl.clone()
      url.pathname = pathname === '/' ? '/editor' : `/editor${pathname}`
      rewriteTo = url
    }
  }

  return updateSession(request, rewriteTo)
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
