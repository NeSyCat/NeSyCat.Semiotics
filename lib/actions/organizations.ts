'use server'

import { randomUUID } from 'node:crypto'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { withRLS, orgMembersFor, type Tx } from '@/lib/db'
import { EDITOR_SUBDOMAIN } from '@/lib/editor-url'
import { sendInvitationEmail } from '@/lib/email'

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

  // Fast path: everything in ONE transaction (acceptance under a savepoint —
  // see below). If that whole transaction dies at the CONNECTION level (the
  // one case the savepoint cannot save: e.g. the socket drops mid-acceptance,
  // taking the ROLLBACK TO SAVEPOINT down with it), retry ONCE on a fresh
  // transaction WITHOUT the acceptance step — restoring the old
  // two-transaction behavior's guarantee that sign-in never depends on the
  // invitations subsystem, without paying its extra round trip on every
  // normal load. Acceptance simply happens on the next page load instead.
  try {
    return await getMeInTx(jwt, userId, email, displayName, true)
  } catch (err) {
    console.error('getMe: transaction failed, retrying once without invitation acceptance:', err)
    return getMeInTx(jwt, userId, email, displayName, false)
  }
}

function getMeInTx(
  jwt: string | null, userId: string, email: string, displayName: string,
  acceptInvitations: boolean,
): Promise<Me> {
  return withRLS(jwt, async (tx) => {
    if (!acceptInvitations) return readOrBootstrap(tx, userId, email, displayName)
    // ACCEPTANCE STEP: turn every open invitation addressed to this session's
    // email into a real membership — an invite is accepted automatically on the
    // invitee's next sign-in, there is no separate "accept" screen (see the
    // design doc's DECIDED ADAPTATIONS).
    //
    // Runs under its own SAVEPOINT inside this same withRLS transaction
    // (merged with the read/bootstrap below to cut a whole extra
    // transaction/round-trip off getMe). The savepoint preserves the
    // original isolation guarantee: signing in must never depend on the
    // invitations subsystem. A failed statement would otherwise abort the
    // *whole* surrounding Postgres transaction — catching the error in JS
    // alone would not help, the transaction is already poisoned. Rolling
    // back to the savepoint instead undoes exactly the acceptance step's
    // statements, so a failure here (say, against a database where
    // `invitations` isn't ready yet during a deploy) gets logged and can be
    // retried on the next page load, while the read/bootstrap below still
    // runs in this same transaction as if acceptance had never been
    // attempted.
    try {
      await tx.execute(tx.sql.raw`SAVEPOINT accept_invitations`.affectedCount().build())
      // Existing memberships are read first so acceptance can skip any org the
      // caller already belongs to: a duplicate membership insert would abort
      // this subtransaction (two tabs opening at once is enough to hit it).
      const existingMemberships = await tx.orm.public.memberships
        .where({ user_id: userId })
        .all()
      const joinedOrgIds = new Set(existingMemberships.map((m) => m.organization_id))

      // Whatever RLS makes visible here (invitee_select already matches
      // lower(email) = lower(jwt email); owner_all also shows an owner the
      // invites they issued), narrowed to the caller's own rows in code —
      // tx.orm has no lower() comparison to express that match in the query.
      const visibleInvitations = await tx.orm.public.invitations.all()
      const myInvitations = visibleInvitations.filter(
        (inv) => inv.email.toLowerCase() === email.toLowerCase(),
      )
      for (const inv of myInvitations) {
        if (!joinedOrgIds.has(inv.organization_id)) {
          // memberships_insert_invited requires exactly this shape: caller's
          // own user_id, and is_owner matching what the invitation specified
          // (no self-promotion via a crafted insert).
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
    } catch (err) {
      console.error('getMe: accepting invitations failed, continuing sign-in:', err)
      await tx.execute(
        tx.sql.raw`ROLLBACK TO SAVEPOINT accept_invitations`.affectedCount().build(),
      )
    }

    return readOrBootstrap(tx, userId, email, displayName)
  })
}

// The read/bootstrap half of getMe — always runs, with or without the
// acceptance step ahead of it (see getMe's retry-without-acceptance path).
async function readOrBootstrap(tx: Tx, userId: string, email: string, displayName: string): Promise<Me> {
  {
    const myMemberships = await tx.orm.public.memberships.where({ user_id: userId }).all()
    if (myMemberships.length > 0) {
      // Restructured from a single memberships⋈organizations join (P8's ORM
      // has no cross-model .include() story this ticket needs) into two
      // sequential reads + an in-code name-sort.
      const orgIds = myMemberships.map((m) => m.organization_id)
      const orgs = await tx.orm.public.organizations.where((o) => o.id.in(orgIds)).all()
      const orgById = new Map(orgs.map((org) => [org.id, org]))
      const rows = myMemberships
        .flatMap((m) => {
          const org = orgById.get(m.organization_id)
          return org
            ? [{ organizationId: org.id, organizationName: org.name, isOwner: m.is_owner }]
            : []
        })
        .sort((a, b) => a.organizationName.localeCompare(b.organizationName))
      return { userId, email, displayName, memberships: rows }
    }

    // BOOTSTRAP (first login, still zero memberships after acceptance above):
    // create a personal org + an
    // owner membership, in the SAME withRLS transaction as the read above —
    // RLS allows this via organizations_insert_auth (insert: true) and
    // memberships_insert_bootstrap (self row, is_owner=true, target org has
    // no members yet). Small create-race window is accepted (mirrors
    // Admination's client-side bootstrap; single-user flow — see design
    // doc's DECIDED ADAPTATIONS).
    // The id is generated HERE, and the insert deliberately returns nothing:
    // Postgres applies SELECT policies to any INSERT ... RETURNING, and
    // organizations_select_member cannot pass for an org whose first
    // membership does not exist yet — a plain ORM .create() (which returns
    // the row) fails with "new row violates row-level security policy".
    // Client-side id + a returning-free insert sidesteps that ordering trap.
    const organizationId = randomUUID()
    const organizationName = `${displayName}'s Organization`
    await tx.execute(
      tx.sql
        .raw`insert into organizations (id, name) values (${organizationId}::uuid, ${organizationName})`
        .affectedCount()
        .build(),
    )
    await tx.orm.public.memberships.create({
      user_id: userId,
      organization_id: organizationId,
      is_owner: true,
    })
    return {
      userId,
      email,
      displayName,
      memberships: [{ organizationId, organizationName, isOwner: true }],
    }
  }
}

export async function renameOrganization(id: string, name: string): Promise<ActionResult> {
  const { jwt } = await session()
  const trimmed = name.trim() || 'Untitled'
  try {
    await withRLS(jwt, (tx) =>
      tx.orm.public.organizations.where({ id }).update({ name: trimmed, updated_at: new Date() }),
    )
  } catch (err) {
    return friendlyFailure('renameOrganization', err)
  }
  revalidatePath('/editor', 'layout')
  return { ok: true }
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
// `warning` is OPTIONAL and only ever set on the ok branch — every existing
// `if (!result.ok)` / `result.error` consumer keeps compiling unchanged; only
// inviteMember's degraded path (row written, email not sent) sets it.
export type ActionResult = { ok: true; warning?: string } | { ok: false; error: string }

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// A generic, human-readable fallback for a mutation that failed for a reason
// the caller shouldn't see verbatim (RLS rejection, connection blip, etc.) —
// the raw error is still console.error'd server-side for diagnosis, but
// never handed to the client (error discipline: don't leak Postgres text).
function friendlyFailure(action: string, err: unknown): ActionResult {
  console.error(`${action} failed:`, err)
  return { ok: false, error: 'Something went wrong. Please try again.' }
}

const NOT_OWNER: ActionResult = {
  ok: false,
  error: 'Only an owner of this organization can do that.',
}

// Is the CALLER an owner of this org? The owner-only actions below all check
// this first, inside their own transaction. RLS already refuses their writes,
// but it refuses by matching zero rows — a silent no-op the action would
// otherwise report as success. This turns that into an honest error.
// (memberships_select_self makes the caller's own row readable.)
async function callerIsOwner(tx: Tx, organizationId: string, callerId: string): Promise<boolean> {
  const own = await tx.orm.public.memberships.first({
    user_id: callerId,
    organization_id: organizationId,
  })
  return own?.is_owner ?? false
}

export async function listOrgRoster(organizationId: string): Promise<OrgRoster> {
  const { jwt } = await session()

  // Both reads run in ONE RLS transaction. Members come from org_members_for
  // (auth.users emails are unreachable through ordinary RLS-scoped queries),
  // which derives the caller from auth.uid() — so it only works here, inside
  // the transaction that sets the claims. Invitations are a plain tx.orm read:
  // invitations_owner_all shows an owner every open invite for orgs they own;
  // a non-owner simply sees none, which is fine — the panel is owner-only.
  const { memberRows, invitationRows } = await withRLS(jwt, async (tx) => ({
    memberRows: await orgMembersFor(tx, organizationId),
    invitationRows: await tx.orm.public.invitations
      .where({ organization_id: organizationId })
      .all(),
  }))

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

// The invitation email links to the editor itself, not to a per-invite
// token — see the module-level note above sendInvitationEmail's caller for
// why. NEXT_PUBLIC_SITE_URL wins when set (so a preview deploy's email
// points at itself); otherwise this falls back to the same
// request-independent EDITOR_SUBDOMAIN constant lib/editor-url.ts already
// uses for canonical links, rather than inventing a second env var.
function inviteAppUrl(): string {
  return process.env.NEXT_PUBLIC_SITE_URL || `https://${EDITOR_SUBDOMAIN}`
}

export async function inviteMember(organizationId: string, rawEmail: string): Promise<ActionResult> {
  const { jwt, userId, email: callerEmail, userMetadata } = await session()
  const email = rawEmail.trim().toLowerCase()
  if (!EMAIL_SHAPE.test(email)) {
    return { ok: false, error: 'Enter a valid email address.' }
  }

  let organizationName = 'this organization'
  try {
    // Pre-checks are advisory (a small TOCTOU race against a concurrent
    // invite/join is accepted, same posture as getMe's bootstrap race) — the
    // invitations PK (organization_id, email) is the real backstop, and a
    // race there surfaces through the catch below as a friendly error. The
    // org row is read here too, purely for the invitation email's copy — its
    // absence isn't a failure condition, hence the plain fallback above
    // rather than threading an Optional through the destructure below.
    const { isOwner, members, alreadyInvited, org } = await withRLS(jwt, async (tx) => ({
      isOwner: await callerIsOwner(tx, organizationId, userId),
      members: await orgMembersFor(tx, organizationId),
      alreadyInvited: await tx.orm.public.invitations.first({
        organization_id: organizationId,
        email,
      }),
      org: await tx.orm.public.organizations.first({ id: organizationId }),
    }))
    if (!isOwner) return NOT_OWNER
    if (members.some((m) => m.email.toLowerCase() === email)) {
      return { ok: false, error: 'This person is already a member.' }
    }
    if (alreadyInvited) {
      return { ok: false, error: 'This person has already been invited.' }
    }
    if (org?.name) organizationName = org.name

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

  // The email is a courtesy notification, not part of the invite's contract
  // — the invitations row above is already the durable, authoritative state
  // (acceptance matches on it at sign-in, see getMe). sendInvitationEmail
  // itself never throws, but the try/catch is kept anyway as a hard backstop
  // so a defect in this call can never turn a successful invite into a
  // reported failure.
  try {
    const invitedByName = displayNameOf(callerEmail, userMetadata)
    const result = await sendInvitationEmail({
      to: email,
      organizationName,
      invitedByName,
      appUrl: inviteAppUrl(),
    })
    if (!result.sent) {
      return {
        ok: true,
        warning: 'Invitation created, but the email could not be sent — tell them to sign in with this address.',
      }
    }
  } catch (err) {
    console.error('inviteMember: sendInvitationEmail threw unexpectedly:', err)
    return {
      ok: true,
      warning: 'Invitation created, but the email could not be sent — tell them to sign in with this address.',
    }
  }

  return { ok: true }
}

export async function revokeInvitation(organizationId: string, rawEmail: string): Promise<ActionResult> {
  const { jwt, userId } = await session()
  const email = rawEmail.trim().toLowerCase()

  try {
    const allowed = await withRLS(jwt, async (tx) => {
      if (!(await callerIsOwner(tx, organizationId, userId))) return false
      await tx.orm.public.invitations
        .where({ organization_id: organizationId, email })
        .delete()
      return true
    })
    if (!allowed) return NOT_OWNER
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
    // Guard and delete share ONE transaction — the roster read only works
    // inside one (org_members_for reads auth.uid()), and it also narrows the
    // window between checking and deleting.
    const outcome = await withRLS(jwt, async (tx) => {
      if (!(await callerIsOwner(tx, organizationId, callerId))) return 'not-owner' as const
      const members = await orgMembersFor(tx, organizationId)
      const target = members.find((m) => m.user_id === userId)
      if (target?.is_owner) {
        const otherOwners = members.filter((m) => m.is_owner && m.user_id !== userId)
        if (otherOwners.length === 0) return 'last-owner' as const
      }
      await tx.orm.public.memberships
        .where({ organization_id: organizationId, user_id: userId })
        .delete()
      return 'done' as const
    })
    if (outcome === 'not-owner') return NOT_OWNER
    if (outcome === 'last-owner') {
      return { ok: false, error: 'An organization must keep at least one owner.' }
    }
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
    // Same last-owner guard as removeMember, only relevant on demotion; guard
    // and update share one transaction for the same reasons.
    const outcome = await withRLS(jwt, async (tx) => {
      if (!(await callerIsOwner(tx, organizationId, callerId))) return 'not-owner' as const
      if (!isOwner) {
        const members = await orgMembersFor(tx, organizationId)
        const otherOwners = members.filter((m) => m.is_owner && m.user_id !== userId)
        if (otherOwners.length === 0) return 'last-owner' as const
      }
      await tx.orm.public.memberships
        .where({ organization_id: organizationId, user_id: userId })
        .update({ is_owner: isOwner, updated_at: new Date() })
      return 'done' as const
    })
    if (outcome === 'not-owner') return NOT_OWNER
    if (outcome === 'last-owner') {
      return { ok: false, error: 'An organization must keep at least one owner.' }
    }
  } catch (err) {
    return friendlyFailure('setMemberOwner', err)
  }

  revalidatePath('/editor', 'layout')
  return { ok: true }
}
