import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_DOMAIN } from '@/lib/editor-url'

function isNesycatHost(host: string): boolean {
  return host === 'nesycat.com' || host === 'www.nesycat.com' || host === 'semiotics.nesycat.com'
}

function makeResponse(request: NextRequest, rewriteTo: URL | null) {
  return rewriteTo
    ? NextResponse.rewrite(rewriteTo, { request })
    : NextResponse.next({ request })
}

export async function updateSession(request: NextRequest, rewriteTo: URL | null = null) {
  const host = request.headers.get('host') ?? ''
  const shareCookieDomain = process.env.NODE_ENV === 'production' && isNesycatHost(host)

  let response = makeResponse(request, rewriteTo)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value))
          response = makeResponse(request, rewriteTo)
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              domain: shareCookieDomain ? COOKIE_DOMAIN : options.domain,
            }),
          )
        },
      },
    },
  )

  await supabase.auth.getUser()
  return response
}
