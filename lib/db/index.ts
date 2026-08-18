import postgres from '@prisma/orm-postgres/runtime'
import type { Contract, FieldInputTypes, FieldOutputTypes } from '@/prisma/contract.d'
import contractJson from '@/prisma/contract.json'

// POSTGRES_URL is the Supabase→Vercel-integration-managed variable: on preview
// deployments it points at the PR's Supabase preview branch, so previews test
// their own migrations instead of hitting production. DATABASE_URL remains the
// local-dev / manual fallback.
const db = postgres<Contract>({
  contractJson,
  url: (process.env.POSTGRES_URL ?? process.env.DATABASE_URL)!,
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
// instead of reaching into FieldOutputTypes/FieldInputTypes directly.
export type Diagram = FieldOutputTypes['public']['Diagrams']
export type NewDiagram = FieldInputTypes['public']['Diagrams']
export type Organization = FieldOutputTypes['public']['Organizations']
export type NewOrganization = FieldInputTypes['public']['Organizations']
export type Membership = FieldOutputTypes['public']['Memberships']
export type NewMembership = FieldInputTypes['public']['Memberships']
