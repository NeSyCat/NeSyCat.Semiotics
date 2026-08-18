import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { NextResponse, type NextRequest } from 'next/server'
import { COOKIE_DOMAIN, editorHrefForHost, isNesycatHost } from '@/lib/editor-url'
import { withRLS, type NewDiagram } from '@/lib/db'
import { emptyData } from '@/lib/constants'
import { getMe } from '@/lib/actions/organizations'
import { resolveActiveOrg } from '@/lib/active-org'

export async function GET(request: NextRequest) {
  const { searchParams, origin, host } = new URL(request.url)
  const code = searchParams.get('code')
  const errorParam = searchParams.get('error') ?? searchParams.get('error_description')

  if (!code) {
    const msg = errorParam ? encodeURIComponent(errorParam) : 'no_code'
    return NextResponse.redirect(`${origin}/?error=${msg}`)
  }

  const cookieStore = await cookies()
  const shareCookieDomain = process.env.NODE_ENV === 'production' && isNesycatHost(host)

  // Placeholder response so the Supabase client can stamp session cookies.
  // The Location header is rewritten once we know the final destination.
  const response = NextResponse.redirect(`${origin}/`)

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

  const { error, data } = await supabase.auth.exchangeCodeForSession(code)
  if (error || !data.session) {
    return NextResponse.redirect(
      `${origin}/?error=${encodeURIComponent(error?.message ?? 'no_session')}`,
    )
  }

  const jwt = data.session.access_token

  // Resolve the post-login destination right here, so the browser makes
  // exactly one redirect hop instead of three (callback → /editor resolver
  // → apex→subdomain 308 → /editor/<id>).
  let diagramId: string
  try {
    const first = await withRLS(jwt, (tx) =>
      tx.orm.public.diagrams
        .select('id')
        .orderBy((d) => d.updated_at.desc())
        .first(),
    )
    if (first) {
      diagramId = first.id
    } else {
      // No diagrams yet for this user's orgs — getMe() bootstraps a personal
      // org on first login (or returns existing memberships), then we pick
      // the active one the same way every other entry point does.
      const me = await getMe()
      const org = await resolveActiveOrg(me)
      if (!org) throw new Error('no organization membership')
      const inserted = await withRLS(jwt, (tx) =>
        tx.orm.public.diagrams
          .select('id')
          // See lib/actions/diagrams.ts's NewDiagram['data'] cast comment.
          .create({
            organization_id: org,
            title: 'Untitled',
            data: emptyData as unknown as NewDiagram['data'],
          }),
      )
      diagramId = inserted.id
    }
  } catch {
    // DB hiccup shouldn't block sign-in — fall back to the resolver page.
    response.headers.set('Location', `${origin}/editor`)
    return response
  }

  const path = editorHrefForHost(host, diagramId)
  // editorHrefForHost returns an absolute URL when crossing hosts (apex→subdomain)
  // and a relative path otherwise. NextResponse.redirect accepts both once we
  // resolve against origin if needed.
  const destination = path.startsWith('http') ? path : `${origin}${path}`
  response.headers.set('Location', destination)
  return response
}
