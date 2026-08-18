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
const rawUrl = (process.env.POSTGRES_URL ?? process.env.DATABASE_URL)!
const db = postgres<Contract>({
  contractJson,
  url: rawUrl.replace(/sslmode=(require|prefer|verify-ca)\b/, 'sslmode=no-verify'),
})

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export async function withRLS<T>(
  jwt: string | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
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
  return db.transaction(async (tx) => {
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
