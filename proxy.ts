import { updateSession } from '@/lib/supabase/proxy'

export const proxy = updateSession

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|auth/callback|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
}
