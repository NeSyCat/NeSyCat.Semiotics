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

    // Invitee's OWN first /editor visit: getMe()'s acceptance step runs
    // BEFORE the bootstrap-a-personal-org branch, so having a pending
    // invitation means they join the inviter's org instead of getting a
    // personal one of their own (lib/actions/organizations.ts).
    const inviteeContext = await browser.newContext({ storageState: INVITEE_STORAGE_STATE })
    const inviteePage = await inviteeContext.newPage()
    try {
      await inviteePage.goto('/editor')
      await inviteePage.waitForURL(/\/editor\/[0-9a-f-]{36}/, { timeout: 20_000 })

      await inviteePage.getByRole('button', { name: 'Account' }).click()
      // Exactly one org — the shared one. If acceptance had NOT run first,
      // getMe() would instead have bootstrapped a fresh personal org, which
      // would still show a count of 1 here, so this alone doesn't prove
      // acceptance; the owner-side re-check below (invitation gone, member
      // row present) is what actually distinguishes the two outcomes.
      await expect(inviteePage.locator('.select-option--row')).toHaveCount(1)
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
