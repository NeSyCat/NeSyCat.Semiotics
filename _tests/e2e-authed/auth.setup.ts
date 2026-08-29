import fs from 'node:fs'
import { test as setup, type Browser } from '@playwright/test'
import { createClient } from '@supabase/supabase-js'
import { injectSupabaseSession } from './lib/session-cookie'
import { assertLocalHost } from './lib/safety'
import { STACK_JSON, PRIMARY_STORAGE_STATE, INVITEE_STORAGE_STATE, AUTH_DIR } from './lib/paths'
import type { StackFile } from './lib/stack-file'

// Playwright "setup project" (see playwright.config.ts's `authed-setup`
// project, which every authed spec project `dependencies` on). The app is
// OAuth-only (see lib/session-cookie.ts's header comment for the full
// investigation) — there is no password sign-in form to drive through the
// UI, so this signs in programmatically against the LOCAL stack with
// signInWithPassword and hand-injects the session cookies @supabase/ssr's
// middleware expects, then saves one storageState per seeded user.
//
// Runs once per `npm run test:e2e:authed` (Playwright setup projects always
// run before their dependents, not per-spec) — both users' storageState
// files land in .generated/auth/, consumed via `test.use({ storageState })`.

function readStack(): StackFile {
  if (!fs.existsSync(STACK_JSON)) {
    throw new Error(
      `${STACK_JSON} is missing — run \`npm run test:e2e:authed:setup\` first ` +
        '(`npm run test:e2e:authed` does this automatically; see ' +
        '_tests/e2e-authed/README.md if you ran playwright directly instead).',
    )
  }
  return JSON.parse(fs.readFileSync(STACK_JSON, 'utf-8')) as StackFile
}

async function signInAndSave(
  browser: Browser,
  stack: StackFile,
  user: { email: string; password: string },
  storageStatePath: string,
): Promise<void> {
  assertLocalHost(stack.apiUrl, 'auth.setup API URL')
  const supabase = createClient(stack.apiUrl, stack.anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data, error } = await supabase.auth.signInWithPassword({ email: user.email, password: user.password })
  if (error || !data.session) {
    throw new Error(`signInWithPassword(${user.email}) against the local stack failed: ${error?.message}`)
  }

  const context = await browser.newContext()
  await injectSupabaseSession(context, { supabaseUrl: stack.apiUrl, session: data.session, appOrigin: stack.appOrigin })

  // Confirm the injected session is actually honored by the real middleware
  // (lib/supabase/proxy.ts calls supabase.auth.getUser() on every request) —
  // /editor for a signed-in user always redirects into a created diagram
  // (app/editor/page.tsx), which is a clean, real-app signal that the
  // cookie was accepted, not just written.
  const page = await context.newPage()
  await page.goto(`${stack.appOrigin}/editor`)
  await page.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })
  await page.close()

  fs.mkdirSync(AUTH_DIR, { recursive: true })
  await context.storageState({ path: storageStatePath })
  await context.close()
}

setup('authenticate primary + invitee against the local stack', async ({ browser }) => {
  const stack = readStack()
  await signInAndSave(browser, stack, stack.primary, PRIMARY_STORAGE_STATE)
  await signInAndSave(browser, stack, stack.invitee, INVITEE_STORAGE_STATE)
})
