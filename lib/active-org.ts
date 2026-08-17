// Server-only helper (not a server action — no 'use server') that resolves
// which organization is "active" for the current request. Reads the
// nesycat-active-org cookie via next/headers cookies(); the cookie itself is
// only ever WRITTEN client-side (UserMenu, on org switch) — Next.js forbids
// cookie writes outside actions/route handlers anyway, and reading here from
// server components/route handlers is fine.

import { cookies } from 'next/headers'
import type { Me } from '@/lib/actions/organizations'

const ACTIVE_ORG_COOKIE = 'nesycat-active-org'

// me.memberships is already name-sorted (see getMe), so "first membership"
// is a stable, deterministic fallback. Returns null only when memberships is
// empty, which cannot happen post-bootstrap (getMe always creates/returns at
// least one) — typed honestly anyway rather than asserting it away.
export async function resolveActiveOrg(me: Me): Promise<string | null> {
  const cookieStore = await cookies()
  const cookieOrgId = cookieStore.get(ACTIVE_ORG_COOKIE)?.value
  if (cookieOrgId && me.memberships.some((m) => m.organizationId === cookieOrgId)) {
    return cookieOrgId
  }
  return me.memberships[0]?.organizationId ?? null
}
