import postgres from '@prisma/orm-postgres/runtime'
import type { Contract, FieldInputTypes, FieldOutputTypes } from '@/prisma/contract.d'
import contractJson from '@/prisma/contract.json'

// POSTGRES_URL is the Supabase→Vercel-integration-managed variable: on preview
// deployments it points at the PR's Supabase preview branch, so previews test
// their own migrations instead of hitting production. DATABASE_URL remains the
// local-dev / manual fallback.
//
// sslmode rewrite: Supabase connection strings carry `sslmode=require`, which
// node-pg (this runtime's driver) escalates to verify-full — and Supabase's
// pooler presents a Supabase-CA certificate, so chain verification dies with
// "self-signed certificate in certificate chain" (first prod deploy of this
// runtime). The previous postgres-js stack treated `require` as
// encrypt-without-verify; `no-verify` restores exactly those semantics.
// URLs without an sslmode (local Docker) pass through untouched. Proper
// future hardening: pin Supabase's CA cert and use verify-full.
const rawUrl = process.env.POSTGRES_URL ?? process.env.DATABASE_URL

// The client is constructed LAZILY (first transaction), NOT at module load:
// this module is transitively imported by pages whose anonymous branches
// never touch the DB (app/editor/page.tsx → lib/actions/*), and an env-less
// boot (CI e2e, a fresh checkout — see lib/supabase/env.ts) must not crash
// on import. Actually USING the DB without a URL fails at the call site
// with a clear message instead of `undefined.replace` on every request.
function mkDb() {
  if (!rawUrl) {
    throw new Error(
      'POSTGRES_URL / DATABASE_URL is not set — database access is unavailable on an env-less (anonymous-only) boot; see lib/supabase/env.ts',
    )
  }
  return postgres<Contract>({
    contractJson,
    url: rawUrl.replace(/sslmode=(require|prefer|verify-ca)\b/, 'sslmode=no-verify'),
  })
}
let _db: ReturnType<typeof mkDb> | null = null
const db = () => (_db ??= mkDb())

export type Tx = Parameters<Parameters<ReturnType<typeof mkDb>['transaction']>[0]>[0]

export async function withRLS<T>(
  jwt: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db().transaction(async (tx) => {
    if (jwt) {
      const claims = JSON.parse(
        Buffer.from(jwt.split('.')[1], 'base64url').toString(),
      )
      // Bind the claims JSON as a parameter via template interpolation — SET
      // LOCAL ROLE below stays literal text (no bind params allowed there).
      await tx.execute(
        tx.sql
          .raw`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`
          .affectedCount()
          .build(),
      )
      await tx.execute(tx.sql.raw`SET LOCAL ROLE authenticated`.affectedCount().build())
    } else {
      await tx.execute(tx.sql.raw`SET LOCAL ROLE anon`.affectedCount().build())
    }
    return fn(tx)
  })
}

export async function withServiceRole<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  return db().transaction(async (tx) => {
    await tx.execute(tx.sql.raw`SET LOCAL ROLE service_role`.affectedCount().build())
    return fn(tx)
  })
}

// Row types the app queries against — aliased off the generated contract so
// call sites (lib/actions/*, components/*) keep importing stable names
// instead of reaching into FieldOutputTypes/FieldInputTypes directly. The
// lookup keys below are the contract's model names (now identical to the
// database's table names — see prisma/contract.prisma's IDENTICAL NAMES
// DOCTRINE); the exported TS type names stay PascalCase and unchanged.
export type Diagram = FieldOutputTypes['public']['diagrams']
export type NewDiagram = FieldInputTypes['public']['diagrams']
export type Organization = FieldOutputTypes['public']['organizations']
export type NewOrganization = FieldInputTypes['public']['organizations']
export type Membership = FieldOutputTypes['public']['memberships']
export type NewMembership = FieldInputTypes['public']['memberships']
export type Invitation = FieldOutputTypes['public']['invitations']
export type NewInvitation = FieldInputTypes['public']['invitations']

// One row of the org roster — the shape prisma/sql/01-functions.sql's
// org_members_for(org) returns.
export type OrgMemberRow = {
  user_id: string
  email: string
  display_name: string
  is_owner: boolean
}

// Roster lookup, run INSIDE the caller's withRLS transaction so the definer
// function sees the verified auth.uid() (it takes no identity argument — see
// prisma/sql/01-functions.sql for why that matters).
//
// `tx.query` is real at runtime but missing from this RC's TransactionContext
// type (only `execute` is declared, and execute discards rows) — hence the
// cast. Verified empirically against the runtime; revisit when the types
// catch up.
export async function orgMembersFor(
  tx: Tx,
  organizationId: string,
): Promise<OrgMemberRow[]> {
  const plan = tx.sql
    .raw`select * from public.org_members_for(${organizationId})`
    .returnsRow({
      user_id: 'pg/uuid@1',
      email: 'pg/text@1',
      display_name: 'pg/text@1',
      is_owner: 'pg/bool@1',
    })
    .build()
  const rows = (tx as unknown as {
    query: <T>(plan: unknown) => { toArray: () => Promise<T[]> }
  }).query<OrgMemberRow>(plan)
  return rows.toArray()
}
