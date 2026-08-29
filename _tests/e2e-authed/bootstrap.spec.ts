import { test, expect } from '@playwright/test'

// Uses the `authed-chromium` project's default storageState (the primary
// user — see playwright.config.ts) — no per-file override needed.
//
// The actual "first login" transaction (getMe()'s bootstrap branch in
// lib/actions/organizations.ts — zero memberships → create a personal org +
// owner membership) necessarily already fired once, during auth.setup.ts's
// own sign-in verification: confirming an injected session cookie is
// honored requires hitting a real authed route, and every authed route
// calls getMe(). This spec asserts the STATE that bootstrap produces (which
// is stable from that point on, however many times /editor is subsequently
// visited) rather than trying to catch the exact transactional moment a
// second time — the same invariant, the only way it's observable from a
// fresh page load.
test.describe('first login bootstrap', () => {
  test('personal org exists, owned, and /editor redirects into a real diagram', async ({ page }) => {
    await page.goto('/editor')
    await page.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })
    await expect(page.locator('.react-flow__pane')).toBeVisible()

    // UserMenu (components/UserMenu.tsx) is the UI-level oracle for
    // membership state, same "read it off the real, already-existing
    // surface" idiom _tests/e2e's README documents for the selection
    // oracle. This user was only ever created fresh by seed-users.ts and
    // never invited anywhere else, so exactly one org — the personal one —
    // is the only state consistent with a correct bootstrap, regardless of
    // what other specs in this run have since done inside that same org
    // (diagram create/rename/delete — never a SECOND org membership).
    await page.getByRole('button', { name: 'Account' }).click()
    await expect(page.locator('.select-option--row')).toHaveCount(1)
    // Owner-only affordance — only rendered for m.isOwner rows.
    await expect(page.getByRole('button', { name: /^Settings for / })).toBeVisible()
  })
})
