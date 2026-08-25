import { defineConfig, devices } from '@playwright/test'

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
const skipWebServer = !!process.env.PLAYWRIGHT_SKIP_WEBSERVER

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
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
  webServer: skipWebServer
    ? undefined
    : {
        command: `npx next dev -p ${PORT}`,
        url: `${BASE_URL}/editor`,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
        stdout: 'pipe',
        stderr: 'pipe',
      },
})
