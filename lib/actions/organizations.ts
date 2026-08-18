'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { withRLS, orgMembersFor } from '@/lib/db'

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
    // ACCEPTANCE STEP (new, runs BEFORE the membership read): turn every open
    // invitation addressed to this session's email into a real membership,
    // across every org — an invite is accepted automatically on next
    // sign-in, no separate "accept" UI (see design doc's DECIDED
    // ADAPTATIONS). Fetch whatever this tx's RLS makes visible (the
    // invitee_select policy already matches lower(email) = lower(jwt
    // email); owner_all also lets an org owner see invites they issued) and
    // narrow to exactly the caller's own rows here in code — tx.orm has no
    // lower() comparison operator to express that match in the query itself.
    // Existing memberships are read FIRST so acceptance can skip any org the
    // caller already belongs to: inserting a duplicate membership would abort
    // this transaction and 500 the sign-in page (two tabs opening at once is
    // enough to hit it), and a stale invitation must never be able to lock
    // someone out of the editor.
    const existingMemberships = await tx.orm.public.memberships
      .where({ user_id: userId })
      .all()
    const joinedOrgIds = new Set(existingMemberships.map((m) => m.organization_id))

    const visibleInvitations = await tx.orm.public.invitations.all()
    const myInvitations = visibleInvitations.filter(
      (inv) => inv.email.toLowerCase() === email.toLowerCase(),
    )
    for (const inv of myInvitations) {
      if (!joinedOrgIds.has(inv.organization_id)) {
        // memberships_insert_invited requires exactly this shape: caller's own
        // user_id, and is_owner matching what the invitation specified (no
        // self-promotion via a crafted insert).
        await tx.orm.public.memberships.create({
          user_id: userId,
          organization_id: inv.organization_id,
          is_owner: inv.is_owner,
        })
      }
      // Accepted ⇒ deleted — the membership row is now the record. A stale
      // invitation for an org already joined is dropped the same way, so it
      // stops showing as "pending" in that org's roster.
      await tx.orm.public.invitations
        .where({ organization_id: inv.organization_id, email: inv.email })
        .delete()
    }

    const myMemberships = await tx.orm.public.memberships.where({ user_id: userId }).all()
    if (myMemberships.length > 0) {
      // Restructured from a single memberships⋈organizations join (P8's ORM
      // has no cross-model .include() story this ticket needs) into two
      // sequential reads + an in-code name-sort.
      const orgIds = myMemberships.map((m) => m.organization_id)
      const orgs = await tx.orm.public.organizations.where((o) => o.id.in(orgIds)).all()
      const orgById = new Map(orgs.map((org) => [org.id, org]))
      return myMemberships
        .flatMap((m) => {
          const org = orgById.get(m.organization_id)
          return org
            ? [{ organizationId: org.id, organizationName: org.name, isOwner: m.is_owner }]
            : []
        })
        .sort((a, b) => a.organizationName.localeCompare(b.organizationName))
    }

    // BOOTSTRAP (first login, still zero memberships after acceptance above):
    // create a personal org + an
    // owner membership, in the SAME withRLS transaction as the read above —
    // RLS allows this via organizations_insert_auth (insert: true) and
    // memberships_insert_bootstrap (self row, is_owner=true, target org has
    // no members yet). Small create-race window is accepted (mirrors
    // Admination's client-side bootstrap; single-user flow — see design
    // doc's DECIDED ADAPTATIONS).
    const org = await tx.orm.public.organizations.create({ name: `${displayName}'s Organization` })
    await tx.orm.public.memberships.create({
      user_id: userId,
      organization_id: org.id,
      is_owner: true,
    })
    return [{ organizationId: org.id, organizationName: org.name, isOwner: true }]
  })

  return { userId, email, displayName, memberships: rows }
}

export async function renameOrganization(id: string, name: string): Promise<void> {
  const { jwt } = await session()
  const trimmed = name.trim() || 'Untitled'
  await withRLS(jwt, (tx) =>
    tx.orm.public.organizations.where({ id }).update({ name: trimmed, updated_at: new Date() }),
  )
  revalidatePath('/editor', 'layout')
}

// ---------------------------------------------------------------------------
// Org settings panel — roster (members + pending invitations) and the
// mutations an owner can run against it. See .foreman/scratch/
// design-org-settings-v4.md §3 for the full semantics; this is the pinned
// interface a parallel UI worker codes against, so signatures/types below
// are exact, not illustrative.
// ---------------------------------------------------------------------------

export type OrgMember = { userId: string; email: string; displayName: string; isOwner: boolean }
export type OrgInvitation = { email: string; isOwner: boolean; createdAt: Date }
export type OrgRoster = { members: OrgMember[]; invitations: OrgInvitation[] }
export type ActionResult = { ok: true } | { ok: false; error: string }

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A generic, human-readable fallback for a mutation that failed for a reason
// the caller shouldn't see verbatim (RLS rejection, connection blip, etc.) —
// the raw error is still console.error'd server-side for diagnosis, but
// never handed to the client (error discipline: don't leak Postgres text).
function friendlyFailure(action: string, err: unknown): ActionResult {
  console.error(`${action} failed:`, err)
  return { ok: false, error: 'Something went wrong. Please try again.' }
}

export async function listOrgRoster(organizationId: string): Promise<OrgRoster> {
  const { jwt, userId } = await session()

  // Members: org_members_for needs auth.users emails, unreachable through
  // RLS-scoped app queries — client-level call (see lib/db's orgMembersFor).
  // Invitations: plain tx.orm read under RLS — invitations_owner_all shows
  // an owner every open invite for orgs they own; a non-owner caller simply
  // sees none (no policy grants it), which is fine — the UI only opens this
  // panel for owners.
  const [memberRows, invitationRows] = await Promise.all([
    orgMembersFor(userId, organizationId),
    withRLS(jwt, (tx) =>
      tx.orm.public.invitations.where({ organization_id: organizationId }).all().toArray(),
    ),
  ])

  return {
    members: memberRows.map((m) => ({
      userId: m.user_id,
      email: m.email,
      displayName: m.display_name,
      isOwner: m.is_owner,
    })),
    invitations: invitationRows
      .map((inv) => ({ email: inv.email, isOwner: inv.is_owner, createdAt: inv.created_at }))
      .sort((a, b) => a.email.localeCompare(b.email)),
  }
}

export async function inviteMember(organizationId: string, rawEmail: string): Promise<ActionResult> {
  const { jwt, userId } = await session()
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL_SHAPE.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' }
  }

  try {
    // Pre-checks are advisory (a small TOCTOU race against a concurrent
    // invite/join is accepted, same posture as getMe's bootstrap race) — the
    // invitations PK (organization_id, email) is the real backstop, and a
    // race there surfaces through the catch below as a friendly error.
    const members = await orgMembersFor(userId, organizationId)
    if (members.some((m) => m.email.toLowerCase() === email)) {
      return { ok: false, error: 'This person is already a member.' }
    }

    const alreadyInvited = await withRLS(jwt, (tx) =>
      tx.orm.public.invitations.first({ organization_id: organizationId, email }),
    )
    if (alreadyInvited) {
      return { ok: false, error: 'This person has already been invited.' }
    }

    // invitations_owner_all's withCheck enforces the caller is an owner of
    // organizationId — a non-owner's insert is rejected by RLS and lands in
    // the catch below as a friendly error, not a raw Postgres one.
    await withRLS(jwt, (tx) =>
      tx.orm.public.invitations.create({
        organization_id: organizationId,
        email,
        is_owner: false,
        invited_by: userId,
      }),
    )
  } catch (err) {
    return friendlyFailure('inviteMember', err)
  }

  revalidatePath('/editor', 'layout')
  return { ok: true }
}

export async function revokeInvitation(organizationId: string, rawEmail: string): Promise<ActionResult> {
  const { jwt } = await session()
  const email = rawEmail.trim().toLowerCase()

  try {
    await withRLS(jwt, (tx) =>
      tx.orm.public.invitations.where({ organization_id: organizationId, email }).delete(),
    )
  } catch (err) {
    return friendlyFailure('revokeInvitation', err)
  }

  revalidatePath('/editor', 'layout')
  return { ok: true }
}

export async function removeMember(organizationId: string, userId: string): Promise<ActionResult> {
  const { jwt, userId: callerId } = await session()

  try {
    // Last-owner guard, in code (the DB trigger is the backstop): removing
    // the org's only owner would strand it, so block it here with a
    // friendly message instead of surfacing whatever the trigger raises.
    const members = await orgMembersFor(callerId, organizationId)
    const target = members.find((m) => m.user_id === userId)
    if (target?.is_owner ?? false) {
      const otherOwners = members.filter((m) => m.is_owner && m.user_id !== userId)
      if (otherOwners.length === 0) {
        return { ok: false, error: 'An organization must keep at least one owner.' }
      }
    }

    await withRLS(jwt, (tx) =>
      tx.orm.public.memberships.where({ organization_id: organizationId, user_id: userId }).delete(),
    )
  } catch (err) {
    return friendlyFailure('removeMember', err)
  }

  revalidatePath('/editor', 'layout')
  return { ok: true }
}

export async function setMemberOwner(
  organizationId: string,
  userId: string,
  isOwner: boolean,
): Promise<ActionResult> {
  const { jwt, userId: callerId } = await session()

  try {
    if (!isOwner) {
      // Same last-owner guard as removeMember, only relevant on demotion.
      const members = await orgMembersFor(callerId, organizationId)
      const otherOwners = members.filter((m) => m.is_owner && m.user_id !== userId)
      if (otherOwners.length === 0) {
        return { ok: false, error: 'An organization must keep at least one owner.' }
      }
    }

    await withRLS(jwt, (tx) =>
      tx.orm.public.memberships
        .where({ organization_id: organizationId, user_id: userId })
        .update({ is_owner: isOwner, updated_at: new Date() }),
    )
  } catch (err) {
    return friendlyFailure('setMemberOwner', err)
  }

  revalidatePath('/editor', 'layout')
  return { ok: true }
}
