'use client'

import { createClient } from '@/lib/supabase/client'
import { startGitHubSignIn } from '@/components/SignInButton'

interface Props {
  isSignedIn: boolean
  callbackUrl: string
  // Kept in the prop signature even though this component no longer reads
  // it — the server pages (app/editor/page.tsx, app/editor/[id]/page.tsx)
  // still pass it, and share/export moved to Canvas.tsx's Export dropdown
  // (which derives the share URL from location.pathname client-side
  // instead), not to a re-plumbed prop through those server components.
  shareBase: string
}

// The classic person/account glyph — one icon for both auth states (the
// button's title/aria-label carries the sign-in-vs-sign-out distinction,
// same as the door-arrow icons this replaced).
function UserIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 19.5c0-3.6 3.36-6.5 7.5-6.5s7.5 2.9 7.5 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// Top-right auth pill: sign in (anon) / sign out (signed-in) — ONE button,
// its own pill. Sharing/exporting no longer lives here (moved to Canvas.tsx's
// Export dropdown in the import/export pill) — this component is auth-only.
export default function AuthSharePill({ isSignedIn, callbackUrl }: Props) {
  const onSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign('/')
  }

  return (
    <div className="pill editor-pill">
      {isSignedIn ? (
        <button className="btn btn-icon" title="Sign out" aria-label="Sign out" onClick={onSignOut}>
          <UserIcon />
        </button>
      ) : (
        <button
          className="btn btn-icon"
          title="Sign in with GitHub"
          aria-label="Sign in with GitHub"
          onClick={() => startGitHubSignIn(callbackUrl)}
        >
          <UserIcon />
        </button>
      )}
    </div>
  )
}
