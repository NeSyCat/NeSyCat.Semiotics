import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_DOMAIN, isNesycatHost } from '@/lib/editor-url'
import { supabaseConfigured } from '@/lib/supabase/env'

function makeResponse(request: NextRequest, rewriteTo: URL | null) {
  return rewriteTo
    ? NextResponse.rewrite(rewriteTo, { request })
    : NextResponse.next({ request })
}

export async function updateSession(request: NextRequest, rewriteTo: URL | null = null) {
  // No Supabase env (CI, fresh checkout) → skip session refresh entirely:
  // every visitor is anonymous, requests must not 500. See lib/supabase/env.ts.
  if (!supabaseConfigured()) return makeResponse(request, rewriteTo)

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
