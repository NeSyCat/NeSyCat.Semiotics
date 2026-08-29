#!/usr/bin/env -S npx tsx
// One-command local bootstrap for the authed e2e lane. Run directly via
// `npm run test:e2e:authed:setup`, or automatically as the first half of
// `npm run test:e2e:authed` (see package.json — chained with `&&`, NOT
// wired through Playwright's own `globalSetup`: that hook runs AFTER
// Playwright has already started `webServer`, per its own task-ordering —
// too late to have `.env.test.local` on disk before `next dev` boots and
// reads its env files once at startup). Safe to re-run: every step is
// either idempotent (the local stack, the SQL/contract bootstrap) or mints
// fresh state on each run (the two seeded users — see lib/seed-users.ts).
//
// Order:
//   1. ensureLocalStack()   — verify/start the LOCAL Supabase stack (Docker)
//   2. bootstrapDatabase()  — mirrors .github/workflows/preview-db.yml's step
//                             order exactly (see that file's own module doc)
//   3. seedUser() × 2       — a primary (org owner) and an invitee, fresh
//                             random emails every run
//   4. writeAuthedEnvFile() — repo-root .env.test.local for the authed
//                             webServer (NODE_ENV=test — see that file's doc)
//   5. write .generated/stack.json — consumed by auth.setup.ts
import crypto from 'node:crypto'
import fs from 'node:fs'
import { ensureLocalStack } from '../lib/local-stack'
import { bootstrapDatabase } from '../lib/bootstrap-db'
import { seedUser } from '../lib/seed-users'
import { writeAuthedEnvFile } from '../lib/env-file'
import { assertLocalHost } from '../lib/safety'
import { GENERATED_DIR, STACK_JSON } from '../lib/paths'
import type { StackFile } from '../lib/stack-file'

const AUTHED_PORT = process.env.PLAYWRIGHT_AUTHED_PORT || '3220'
const APP_ORIGIN = process.env.PLAYWRIGHT_AUTHED_BASE_URL || `http://localhost:${AUTHED_PORT}`
const TEST_PASSWORD = 'E2eAuthed!23' // local-stack-only fixture; not a real secret

// Exported (not just invoked below) so a Node script/REPL could drive it
// in-process if ever needed; the standard entrypoint is this file's own CLI
// guard at the bottom, run via the npm scripts above.
export async function runSetup(): Promise<void> {
  console.log('[e2e-authed setup] 1/4 Checking / starting local Supabase stack…')
  const stack = ensureLocalStack()
  assertLocalHost(stack.apiUrl, 'stack API URL')
  assertLocalHost(stack.dbUrl, 'stack DB URL')

  console.log('[e2e-authed setup] 2/4 Bootstrapping schema against the local DB…')
  await bootstrapDatabase(stack.dbUrl)

  console.log('[e2e-authed setup] 3/4 Seeding two fresh test users…')
  const runId = crypto.randomBytes(4).toString('hex')
  const primary = await seedUser(stack.apiUrl, stack.serviceRoleKey, `e2e-authed-primary-${runId}@example.test`, TEST_PASSWORD)
  const invitee = await seedUser(stack.apiUrl, stack.serviceRoleKey, `e2e-authed-invitee-${runId}@example.test`, TEST_PASSWORD)

  console.log('[e2e-authed setup] 4/4 Writing .env.test.local and stack.json…')
  writeAuthedEnvFile({ supabaseUrl: stack.apiUrl, anonKey: stack.anonKey, dbUrl: stack.dbUrl })

  fs.mkdirSync(GENERATED_DIR, { recursive: true })
  const stackFile: StackFile = { apiUrl: stack.apiUrl, anonKey: stack.anonKey, appOrigin: APP_ORIGIN, primary, invitee }
  fs.writeFileSync(STACK_JSON, JSON.stringify(stackFile, null, 2))

  console.log('[e2e-authed setup] Done. Run `E2E_AUTHED=1 npx playwright test --project=authed-setup --project=authed-chromium` next (or just `npm run test:e2e:authed`, which runs this first).')
}

// CLI entrypoint — only fires when this file is executed directly
// (`npx tsx scripts/setup.ts` / `npm run test:e2e:authed:setup`), not if
// ever imported elsewhere for its `runSetup` export.
if (require.main === module) {
  runSetup().catch((err) => {
    console.error('\n[e2e-authed setup] FAILED:\n')
    console.error(err instanceof Error ? err.message : err)
    process.exit(1)
  })
}
