'use client'

import { startGitHubSignIn } from '@/lib/auth'

interface Props {
  callbackUrl: string
}

// The classic person/account glyph — the button's title/aria-label carries
// the sign-in semantics (kept alongside UserMenu's own copy of this icon —
// see that component's comment; two separate components, same idiom).
function UserIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 19.5c0-3.6 3.36-6.5 7.5-6.5s7.5 2.9 7.5 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// Top-right auth pill, anonymous-only: sign in with GitHub. The signed-in
// branch this used to have moved to UserMenu.tsx (name/email/sign-out/orgs
// popover), which now renders wherever a signed-in user's topRight pill is
// needed — this component's only remaining caller is the anonymous branch
// of app/editor/page.tsx.
export default function AuthSharePill({ callbackUrl }: Props) {
  return (
    <div className="pill editor-pill">
      <button
        className="btn btn-icon"
        title="Sign in with GitHub"
        aria-label="Sign in with GitHub"
        onClick={() => startGitHubSignIn(callbackUrl)}
      >
        <UserIcon />
      </button>
    </div>
  )
}
