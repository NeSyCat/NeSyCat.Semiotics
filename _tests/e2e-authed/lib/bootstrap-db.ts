import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { Client } from 'pg'
import { REPO_ROOT, SQL_DIR } from './paths'
import { assertLocalHost } from './safety'

// Bootstraps a fresh (or already-bootstrapped) local Postgres against
// prisma/contract.prisma, mirroring .github/workflows/preview-db.yml's step
// order EXACTLY (see that file's own comments for why each step exists and
// why the order matters — repeated here only where this script diverges):
//
//   1. `prisma contract emit`                    (offline; writes contract.json/.d.ts)
//   2. psql-equivalent: prisma/sql/01-functions.sql   (RLS helper functions —
//      must exist before policy creation on a fresh DB)
//   3. psql-equivalent: prisma/sql/00-preflight.sql   (one-time structural
//      changes the contract planner can't derive; no-op on a fresh DB)
//   4. `prisma db verify` → three-way route, identical to preview-db.yml:
//        - CONTRACT.MARKER_MISSING  → fresh DB  → `prisma db init -y`
//        - ok / CONTRACT.MARKER_MISMATCH → signed → `prisma db update -y --advance-ref db`
//        - anything else → abort, don't guess
//   5. psql-equivalent: prisma/sql/02-guards.sql      (orphan-org guard trigger)
//   6. psql-equivalent: prisma/sql/03-realtime.sql    (adds public.diagrams to
//      the supabase_realtime publication — required for any Realtime event
//      to flow at all; see _tests/e2e/README.md's "Realtime" section)
//
// DEVIATION FROM preview-db.yml, BY DESIGN: that workflow shells out to the
// system `psql` binary for steps 2/3/5/6. This script uses `pg` (already a
// runtime dependency — lib/db/index.ts's own connection library) with the
// simple query protocol instead, which — like psql — executes a file's
// entire text as one or more statements, including the files' `DO $$ …
// END $$;` blocks. This avoids requiring `psql` as an extra local
// prerequisite beyond Docker + the Supabase CLI + Node (`psql` is NOT on
// PATH on the machine this lane was built on) while running the identical,
// already-idempotent SQL files in the identical order. Functionally
// equivalent, not a behavior change to the SQL itself.
export async function bootstrapDatabase(dbUrl: string): Promise<void> {
  assertLocalHost(dbUrl, 'bootstrap target DB URL')

  const emit = runPrisma(['contract', 'emit'], dbUrl)
  if (emit.status !== 0) throw new Error(`\`prisma contract emit\` failed:\n${emit.output}`)

  await withClient(dbUrl, async (client) => {
    await runSqlFile(client, '01-functions.sql')
    await runSqlFile(client, '00-preflight.sql')
  })

  const verify = runPrisma(['db', 'verify'], dbUrl)
  if (verify.status === 0 || /CONTRACT\.MARKER_MISMATCH/.test(verify.output)) {
    console.log('[e2e-authed] DB is signed — applying incremental `prisma db update`.')
    const update = runPrisma(['db', 'update', '-y', '--advance-ref', 'db'], dbUrl)
    if (update.status !== 0) throw new Error(`\`prisma db update\` failed:\n${update.output}`)
  } else if (/CONTRACT\.MARKER_MISSING/.test(verify.output)) {
    console.log('[e2e-authed] DB is fresh/unsigned — bootstrapping with `prisma db init`.')
    const init = runPrisma(['db', 'init', '-y'], dbUrl)
    if (init.status !== 0) throw new Error(`\`prisma db init\` failed:\n${init.output}`)
  } else {
    throw new Error(`\`prisma db verify\` failed unexpectedly — refusing to guess:\n${verify.output}`)
  }

  await withClient(dbUrl, async (client) => {
    await runSqlFile(client, '02-guards.sql')
    await runSqlFile(client, '03-realtime.sql')
  })
}

async function withClient(dbUrl: string, fn: (client: Client) => Promise<void>): Promise<void> {
  const client = new Client({ connectionString: dbUrl })
  await client.connect()
  try {
    await fn(client)
  } finally {
    await client.end()
  }
}

async function runSqlFile(client: Client, file: string): Promise<void> {
  const sql = fs.readFileSync(path.join(SQL_DIR, file), 'utf-8')
  console.log(`[e2e-authed] Applying prisma/sql/${file}…`)
  await client.query(sql)
}

function runPrisma(args: string[], dbUrl: string): { status: number; output: string } {
  const r = spawnSync('npx', ['prisma', ...args, '--config', 'prisma/prisma.config.ts'], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    // PRISMA_DB_URL takes priority over DIRECT_URL in prisma/prisma.config.ts
    // (`process.env.PRISMA_DB_URL ?? process.env.DIRECT_URL`) — setting it
    // here, already present before that config's own dotenv call runs in the
    // child process, means dotenv (which never overwrites an existing var)
    // leaves it alone even though .env.local also sets DIRECT_URL to the
    // REMOTE project. This is the load-bearing line that keeps every prisma
    // CLI call in this lane pinned to the local stack.
    env: { ...process.env, PRISMA_DB_URL: dbUrl },
  })
  return { status: r.status ?? 1, output: `${r.stdout ?? ''}\n${r.stderr ?? ''}` }
}
