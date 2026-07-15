'use client'

import { useState } from 'react'
import { useStore } from '@/components/editor2/store'
import { encodeDiagramToFragment } from '@/components/editor2/share'
import { createClient } from '@/lib/supabase/client'
import { GitHubIcon, startGitHubSignIn } from '@/components/SignInButton'

interface Props {
  isSignedIn: boolean
  callbackUrl: string
  shareBase: string
}

function ShareIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="18" cy="5" r="3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="6" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
      <circle cx="18" cy="19" r="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.6 10.5l6.8-3.9M8.6 13.5l6.8 3.9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

function CheckIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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

// Top-right pill: Share (anon + signed-in) plus Sign in (anon) / Sign out
// (signed-in). No positioning of its own — the parent (Canvas.tsx's
// top-right corner block) owns placement via a pill-cluster.
export default function AuthSharePill({ isSignedIn, callbackUrl, shareBase }: Props) {
  const [copied, setCopied] = useState(false)

  const onShare = async () => {
    const diagram = useStore.getState().diagram
    const frag = await encodeDiagramToFragment(diagram)
    const u = new URL(shareBase, location.origin)
    const shareUrl = `${u.href}#${frag}`
    try {
      await navigator.clipboard.writeText(shareUrl)
    } catch {
      window.prompt('Copy this link:', shareUrl)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const onSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign('/')
  }

  return (
    <div className="pill editor-pill">
      <button className="btn" title="Copy share link" aria-label="Copy share link" onClick={onShare}>
        {copied ? <CheckIcon /> : <ShareIcon />}
        {copied ? 'Copied' : 'Share'}
      </button>
      {isSignedIn ? (
        <button className="btn" title="Sign out" aria-label="Sign out" onClick={onSignOut}>
          <SignOutIcon />
          Sign out
        </button>
      ) : (
        <button
          className="btn"
          title="Sign in with GitHub"
          aria-label="Sign in with GitHub"
          onClick={() => startGitHubSignIn(callbackUrl)}
        >
          <GitHubIcon size={24} style={{ fill: 'currentColor', stroke: 'none' }} />
          Sign in
        </button>
      )}
    </div>
  )
}
