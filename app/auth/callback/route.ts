import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/editor'
  const errorParam = searchParams.get('error') ?? searchParams.get('error_description')

  if (!code) {
    const msg = errorParam ? encodeURIComponent(errorParam) : 'no_code'
    return NextResponse.redirect(`${origin}/?error=${msg}`)
  }

  const response = NextResponse.redirect(`${origin}${next}`)
  const cookieStore = await cookies()

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (list) =>
          list.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
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
