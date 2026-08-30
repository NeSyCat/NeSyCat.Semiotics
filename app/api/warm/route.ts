import { NextResponse } from 'next/server'
import { withRLS } from '@/lib/db'

// Keep-warm target (hit by .github/workflows/keep-warm.yml every ~5min):
// a request here keeps this Fluid instance alive AND exercises one trivial
// DB transaction, so the lazily-constructed Postgres client (lib/db) and its
// pooled TLS connection stay warm too. Cold starts were the last big chunk
// of first-visit latency (~1.5s server wait vs ~0.6s warm, measured); with
// this ping nearly every real visit lands on a warm instance.
//
// anon role + `select 1` — no data touched, no privileges needed. Never
// throws: an env-less boot (CI e2e, fresh checkout) or a DB hiccup returns
// 204 all the same; the ping's job is warming, not health-reporting.
export async function GET() {
  try {
    if (process.env.POSTGRES_URL || process.env.DATABASE_URL) {
      await withRLS(null, async (tx) => {
        await tx.execute(tx.sql.raw`select 1`.affectedCount().build())
      })
    }
  } catch (err) {
    console.error('warm ping: DB touch failed (instance still warmed):', err)
  }
  return new NextResponse(null, { status: 204 })
}
