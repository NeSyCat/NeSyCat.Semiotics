'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { withRLS } from '@/lib/db'

// Same session() idiom as lib/actions/diagrams.ts, extended with the display
// fields getMe needs (email + user_metadata) — GitHub OAuth is the only
// provider, so there's no separate profile table (see design doc's DECIDED
// ADAPTATIONS: no `members` table, display name/email come straight off
// auth.users).
async function session() {
  const supabase = await createClient()
  const {
    data: { session: s },
  } = await supabase.auth.getSession()
  if (!s) throw new Error('not authenticated')
  return {
    jwt: s.access_token,
    userId: s.user.id,
    email: s.user.email ?? '',
    userMetadata: (s.user.user_metadata ?? {}) as Record<string, unknown>,
  }
}

function displayNameOf(email: string, userMetadata: Record<string, unknown>): string {
  const fullName = userMetadata.full_name
  const name = userMetadata.name
  if (typeof fullName === 'string' && fullName.trim()) return fullName
  if (typeof name === 'string' && name.trim()) return name
  return email.split('@')[0] || 'User'
}

export type MeMembership = { organizationId: string; organizationName: string; isOwner: boolean }
export type Me = { userId: string; email: string; displayName: string; memberships: MeMembership[] }

export async function getMe(): Promise<Me> {
  const { jwt, userId, email, userMetadata } = await session()
  const displayName = displayNameOf(email, userMetadata)

  const rows = await withRLS(jwt, async (tx) => {
    const myMemberships = await tx.orm.public.Memberships.where({ userId }).all()
    if (myMemberships.length > 0) {
      // Restructured from a single memberships⋈organizations join (P8's ORM
      // has no cross-model .include() story this ticket needs) into two
      // sequential reads + an in-code name-sort.
      const orgIds = myMemberships.map((m) => m.organizationId)
      const orgs = await tx.orm.public.Organizations.where((o) => o.id.in(orgIds)).all()
      const orgById = new Map(orgs.map((org) => [org.id, org]))
      return myMemberships
        .flatMap((m) => {
          const org = orgById.get(m.organizationId)
          return org
            ? [{ organizationId: org.id, organizationName: org.name, isOwner: m.isOwner }]
            : []
        })
        .sort((a, b) => a.organizationName.localeCompare(b.organizationName))
    }

    // BOOTSTRAP (first login, zero memberships): create a personal org + an
    // owner membership, in the SAME withRLS transaction as the read above —
    // RLS allows this via organizations_insert_auth (insert: true) and
    // memberships_insert_bootstrap (self row, is_owner=true, target org has
    // no members yet). Small create-race window is accepted (mirrors
    // Admination's client-side bootstrap; single-user flow — see design
    // doc's DECIDED ADAPTATIONS).
    const org = await tx.orm.public.Organizations.create({ name: `${displayName}'s Organization` })
    await tx.orm.public.Memberships.create({
      userId,
      organizationId: org.id,
      isOwner: true,
    })
    return [{ organizationId: org.id, organizationName: org.name, isOwner: true }]
  })

  return { userId, email, displayName, memberships: rows }
}

export async function renameOrganization(id: string, name: string): Promise<void> {
  const { jwt } = await session()
  const trimmed = name.trim() || 'Untitled'
  await withRLS(jwt, (tx) =>
    tx.orm.public.Organizations.where({ id }).update({ name: trimmed, updatedAt: new Date() }),
  )
  revalidatePath('/editor', 'layout')
}
