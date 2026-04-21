import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_DOMAIN } from '@/lib/editor-url'

const NESYCAT_HOSTS = new Set(['nesycat.com', 'www.nesycat.com', 'semiotics.nesycat.com'])

export async function GET(request: NextRequest) {
  const { searchParams, origin, host } = new URL(request.url)
  const code = searchParams.get('code')
  const defaultNext = host === 'semiotics.nesycat.com' ? '/' : '/editor'
  const next = searchParams.get('next') ?? defaultNext
  const errorParam = searchParams.get('error') ?? searchParams.get('error_description')

  if (!code) {
    const msg = errorParam ? encodeURIComponent(errorParam) : 'no_code'
    return NextResponse.redirect(`${origin}/?error=${msg}`)
  }

  const response = NextResponse.redirect(`${origin}${next}`)
  const cookieStore = await cookies()
  const shareCookieDomain = process.env.NODE_ENV === 'production' && NESYCAT_HOSTS.has(host)

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) =>
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, {
              ...options,
              domain: shareCookieDomain ? COOKIE_DOMAIN : options.domain,
            }),
          ),
      },
    },
  )

  const { error } = await supabase.auth.exchangeCodeForSession(code)
  if (error) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(error.message)}`,
    )
  }

  return response
}
