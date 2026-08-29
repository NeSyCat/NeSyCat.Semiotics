import { defineConfig, devices, type PlaywrightTestProject } from '@playwright/test'

// Real-browser E2E suite over the React Flow diagram editor. Boots its OWN
// dev server on a dedicated port (3210) so it never collides with a
// developer's own `npm run dev` (default port 3000/3456) — see
// _tests/e2e/README.md for the full rationale.
//
// Deliberately runs `next dev`, not a production build: `npm run build`
// shells out to scripts/vercel-prebuild.sh, which needs the private
// `vendor/Admination.02-Design` git submodule checked out. That's fine on a
// dev machine (already checked out) but fragile in CI (needs
// ADMINATION_DS_TOKEN) — the dev server sidesteps prod-build fragility
// entirely while still exercising the real app.
const PORT = Number(process.env.PLAYWRIGHT_PORT) || 3210
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL || `http://localhost:${PORT}`
// Escape hatch for a machine that already has a dev server running this
// exact working tree on some other port (e.g. Next 16's own per-project
// `experimental.lockDistDir` refuses a second `next dev` against the same
// distDir regardless of port — see _tests/e2e/README.md's "Dedicated port"
// section): set PLAYWRIGHT_BASE_URL to that server and
// PLAYWRIGHT_SKIP_WEBSERVER=1 to point the suite at it directly instead of
// spawning a new one. The committed default (no env vars set) always spawns
// its own dedicated-port server, per the ticket.
//
// Reused, unchanged, by the authed npm scripts below (`test:e2e:authed`) —
// setting it there skips only THIS (anonymous, port 3210) webServer entry;
// the authed one (port 3220) is gated purely on E2E_AUTHED and always
// starts when that's set, so `E2E_AUTHED=1 PLAYWRIGHT_SKIP_WEBSERVER=1
// playwright test --project=authed-chromium` doesn't waste time spinning up
// a dev server nothing in that run will ever hit.
const skipWebServer = !!process.env.PLAYWRIGHT_SKIP_WEBSERVER

// ── AUTHENTICATED lane (_tests/e2e-authed) — gated on E2E_AUTHED=1 ─────────
// A SEPARATE testDir, project set, port, and webServer from the anonymous
// lane above, so `npm run test:e2e` (E2E_AUTHED unset) is byte-for-byte
// unchanged: it never evaluates a single line below, never spawns the
// authed webServer, and needs no Docker/Supabase locally. See
// _tests/e2e-authed/README.md for the full picture — in short: a LOCAL
// Supabase stack (never the remote/production one from .env.local) backs a
// second `next dev` on a second dedicated port, bootstrapped by
// `npm run test:e2e:authed:setup` (chained automatically by
// `test:e2e:authed`, NOT via Playwright's own `globalSetup` — that hook
// runs AFTER webServer has already started, too late to have
// `.env.test.local` on disk before `next dev` reads its env files once at
// boot; see scripts/setup.ts's header comment).
const authedEnabled = process.env.E2E_AUTHED === '1'
const AUTHED_PORT = Number(process.env.PLAYWRIGHT_AUTHED_PORT) || 3220
const AUTHED_BASE_URL = process.env.PLAYWRIGHT_AUTHED_BASE_URL || `http://localhost:${AUTHED_PORT}`

const projects: PlaywrightTestProject[] = [
  { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
  { name: 'webkit', use: { ...devices['Desktop Safari'] } },
]

if (authedEnabled) {
  projects.push(
    {
      name: 'authed-setup',
      testDir: '_tests/e2e-authed',
      testMatch: /.*\.setup\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: AUTHED_BASE_URL },
    },
    {
      name: 'authed-chromium',
      testDir: '_tests/e2e-authed',
      testMatch: /.*\.spec\.ts/,
      dependencies: ['authed-setup'],
      use: {
        ...devices['Desktop Chrome'],
        baseURL: AUTHED_BASE_URL,
        // Per-file `test.use({ storageState: ... })` overrides this for
        // specs needing the invitee/a second identity (invitations.spec.ts)
        // — see _tests/e2e-authed/lib/paths.ts for both generated paths.
        storageState: '_tests/e2e-authed/.generated/auth/primary.json',
      },
    },
  )
}

interface WebServerConfig {
  name?: string
  command: string
  url: string
  reuseExistingServer?: boolean
  timeout?: number
  stdout?: 'pipe' | 'ignore'
  stderr?: 'pipe' | 'ignore'
  env?: Record<string, string>
}
const webServers: WebServerConfig[] = []
if (!skipWebServer) {
  webServers.push({
    command: `npx next dev -p ${PORT}`,
    url: `${BASE_URL}/editor`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  })
}
if (authedEnabled) {
  webServers.push({
    name: 'authed',
    command: `npx next dev -p ${AUTHED_PORT}`,
    url: `${AUTHED_BASE_URL}/editor`,
    // Always fresh, even locally — a stray `next dev -p 3220` left running
    // against a PREVIOUS local-stack incarnation (different seeded users,
    // different .env.test.local) would silently serve stale env/session
    // wiring to this run.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
    // Forces Next.js to skip `.env.local` (the real, remote-pointing file)
    // entirely and load `.env.test.local` (written by scripts/setup.ts)
    // first — see that file's own header comment for the full mechanism.
    // This env object wins over the ambient process.env for this one
    // spawned process (playwright-core's WebServerPlugin merges
    // `{...process.env, ...this._options.env}`).
    env: { NODE_ENV: 'test' },
  })
}

export default defineConfig({
  testDir: '_tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['html', { open: 'never' }]],
  timeout: 30_000,
  expect: {
    timeout: 5_000,
  },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects,
  webServer: webServers.length > 0 ? webServers : undefined,
})
