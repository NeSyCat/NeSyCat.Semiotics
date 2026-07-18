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

function SignInIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 4h8a2 2 0 012 2v12a2 2 0 01-2 2H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M3 12h11m0 0l-3.5-3.5M14 12l-3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

function SignOutIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M15 4H7a2 2 0 00-2 2v12a2 2 0 002 2h8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 12h11m0 0l-3.5-3.5M21 12l-3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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
          <SignOutIcon />
        </button>
      ) : (
        <button
          className="btn btn-icon"
          title="Sign in with GitHub"
          aria-label="Sign in with GitHub"
          onClick={() => startGitHubSignIn(callbackUrl)}
        >
          <SignInIcon />
        </button>
      )}
    </div>
  )
}
