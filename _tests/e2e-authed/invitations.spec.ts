import fs from 'node:fs'
import { test, expect } from '@playwright/test'
import { PRIMARY_STORAGE_STATE, INVITEE_STORAGE_STATE, STACK_JSON } from './lib/paths'
import type { StackFile } from './lib/stack-file'

// Drives the REAL invite UI (components/OrgSettings.tsx, opened from
// components/UserMenu.tsx's owner-only gear) — feasible headless because
// Brevo (the optional invite-notification email) degrading to "row written,
// warning surfaced" when unconfigured (root CLAUDE.md's "Invitation emails"
// section) means inviteMember() still succeeds with no email server needed
// at all, local or otherwise.
test('invite via the app UI; the invitee auto-accepts on first /editor load', async ({ browser }) => {
  const stack: StackFile = JSON.parse(fs.readFileSync(STACK_JSON, 'utf-8'))

  const ownerContext = await browser.newContext({ storageState: PRIMARY_STORAGE_STATE })
  const ownerPage = await ownerContext.newPage()
  try {
    await ownerPage.goto('/editor')
    await ownerPage.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })

    await ownerPage.getByRole('button', { name: 'Account' }).click()
    await ownerPage.getByRole('button', { name: /^Settings for / }).click()
    const settingsDialog = ownerPage.getByRole('dialog')
    await expect(settingsDialog).toBeVisible()

    await settingsDialog.getByPlaceholder('name@example.com').fill(stack.invitee.email)
    await settingsDialog.getByRole('button', { name: 'Invite' }).click()

    const inviteRow = settingsDialog.locator('.org-settings-row', { hasText: stack.invitee.email })
    await expect(inviteRow).toBeVisible()
    await expect(inviteRow.locator('.org-settings-badge--pending')).toBeVisible()

    // NOT actually the invitee's first-ever /editor visit: auth.setup.ts
    // (the `authed-setup` project every authed spec depends on) already
    // signed the invitee in and hit /editor once to capture storageState —
    // BEFORE this invitation existed — which already bootstrapped them a
    // personal org via getMe()'s bootstrap branch. So by the time THIS visit
    // runs, the invitee already has one membership going in; getMe()'s
    // acceptance step (which runs before the read/bootstrap branch, and
    // skips bootstrapping a SECOND org once any membership exists) adds the
    // inviter's org as a second one. Two rows, not one — asserting exactly
    // one here doesn't distinguish "acceptance ran" from "it didn't" either
    // way, which is why the owner-side re-check below (invitation gone,
    // member row present) is what actually proves it.
    const inviteeContext = await browser.newContext({ storageState: INVITEE_STORAGE_STATE })
    const inviteePage = await inviteeContext.newPage()
    try {
      await inviteePage.goto('/editor')
      await inviteePage.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })

      await inviteePage.getByRole('button', { name: 'Account' }).click()
      // The invitee has their own bootstrapped personal org, PLUS the org
      // just joined via acceptance — but an absolute row count is brittle:
      // the local stack persists across runs, and every rerun of this spec
      // (without fresh seeding) adds one more accepted membership. Assert
      // the thing acceptance actually proves: the INVITER's org (the
      // primary user's personal org, named by getMe's bootstrap) now shows
      // in the invitee's org switcher, alongside at least their own.
      const inviterOrgName = new RegExp(`'s Organization`)
      await expect(
        inviteePage.locator('.select-option--row').filter({ hasText: inviterOrgName }).first(),
      ).toBeVisible()
      await expect
        .poll(async () => inviteePage.locator('.select-option--row').count())
        .toBeGreaterThanOrEqual(2)
    } finally {
      await inviteeContext.close()
    }

    // Back on the owner's side: reopen the roster — the invitation row is
    // gone, replaced by a real membership row for the invitee's email.
    await ownerPage.reload()
    await ownerPage.getByRole('button', { name: 'Account' }).click()
    await ownerPage.getByRole('button', { name: /^Settings for / }).click()
    const settingsDialogAfter = ownerPage.getByRole('dialog')
    await expect(settingsDialogAfter).toBeVisible()

    const memberRow = settingsDialogAfter.locator('.org-settings-row', { hasText: stack.invitee.email })
    await expect(memberRow).toBeVisible()
    await expect(memberRow.locator('.org-settings-badge--pending')).toHaveCount(0)
  } finally {
    await ownerContext.close()
  }
})
