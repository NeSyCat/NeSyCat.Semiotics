// The ONLY Brevo-aware module in this repo — mirrors the shape of
// Admination.01-Tech.V2's functions/email/send-email.ts (BrevoClient built
// from BREVO_API_KEY, transactionalEmails.sendTransacEmail, messageId
// handling) but deliberately smaller: this app sends exactly one kind of
// email (an invitation notice, no token/magic link — acceptance is done by
// matching the invitee's sign-in email against the invitations row, see
// getMe in lib/actions/organizations.ts), so there's no provider-agnostic
// EmailMessage abstraction to maintain, just this one function.
//
// Never throws. A misconfigured or failing send must not take the invite
// action down with it — callers get back a discriminated result and decide
// what to tell the user.
import { BrevoClient } from '@getbrevo/brevo'

export interface SendInvitationEmailArgs {
  to: string
  organizationName: string
  invitedByName: string
  appUrl: string
}

export type SendInvitationEmailResult = { sent: true } | { sent: false; reason: string }

let client: BrevoClient | undefined

function getClient(apiKey: string): BrevoClient {
  if (!client) client = new BrevoClient({ apiKey, timeoutInSeconds: 20, maxRetries: 1 })
  return client
}

function buildText({ organizationName, invitedByName, appUrl }: SendInvitationEmailArgs): string {
  return [
    `${invitedByName} invited you to join ${organizationName} on NeSyCat Semiotics.`,
    '',
    `Open the editor: ${appUrl}`,
    '',
    "Sign in with this email address — the invitation only applies to the address it was sent to.",
  ].join('\n')
}

function buildHtml({ organizationName, invitedByName, appUrl }: SendInvitationEmailArgs): string {
  // Inline styles only — email clients strip <style> blocks. Kept to a
  // single column, no external assets, so it renders identically everywhere.
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f4f5;font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#18181b;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      <tr>
        <td align="center">
          <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:8px;padding:32px;">
            <tr>
              <td style="font-size:16px;line-height:1.5;">
                <p style="margin:0 0 16px;">
                  <strong>${escapeHtml(invitedByName)}</strong> invited you to join
                  <strong>${escapeHtml(organizationName)}</strong> on NeSyCat Semiotics.
                </p>
                <p style="margin:0 0 24px;">
                  <a href="${escapeAttr(appUrl)}"
                     style="display:inline-block;background:#18181b;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:600;">
                    Open the editor
                  </a>
                </p>
                <p style="margin:0;font-size:13px;line-height:1.5;color:#71717a;">
                  Sign in with this email address — the invitation only applies to the address it was sent to.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/"/g, '&quot;')
}

export async function sendInvitationEmail(
  args: SendInvitationEmailArgs,
): Promise<SendInvitationEmailResult> {
  const apiKey = process.env.BREVO_API_KEY
  const fromEmail = process.env.INVITE_EMAIL_FROM
  // A key AND a verified sender address are both required to send anything —
  // treat either being absent as the same "not configured" outcome. This is
  // the default local/preview state (no Brevo account wired up), so it's
  // logged at info level, not error: it isn't a failure, it's expected.
  if (!apiKey || !fromEmail) {
    console.info('sendInvitationEmail: BREVO_API_KEY or INVITE_EMAIL_FROM not set — skipping send.')
    return { sent: false, reason: 'not-configured' }
  }
  const fromName = process.env.INVITE_EMAIL_FROM_NAME || 'NeSyCat Semiotics'

  try {
    const brevo = getClient(apiKey)
    const response = await brevo.transactionalEmails.sendTransacEmail({
      sender: { email: fromEmail, name: fromName },
      to: [{ email: args.to }],
      subject: `You've been invited to ${args.organizationName} on NeSyCat Semiotics`,
      htmlContent: buildHtml(args),
      textContent: buildText(args),
    })
    // SendTransacEmailResponse carries `messageId` (single send, our only
    // case) OR `messageIds` (batch sends, never used here) — both optional
    // per the SDK's own type. messageIds is a defensive fallback only.
    const messageId = response.messageId ?? response.messageIds?.[0]
    if (!messageId) {
      console.error('sendInvitationEmail: Brevo returned no messageId.', response)
      return { sent: false, reason: 'no-message-id' }
    }
    return { sent: true }
  } catch (err) {
    console.error('sendInvitationEmail: Brevo send failed:', err)
    return { sent: false, reason: 'send-failed' }
  }
}
