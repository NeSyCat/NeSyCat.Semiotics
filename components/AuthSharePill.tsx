'use client'

import { useEffect, useRef, useState } from 'react'
import { useStore } from '@/components/editor2/store'
import { encodeDiagramToFragment } from '@/components/editor2/share'
import { diagramToTikz } from '@/components/editor2/tikz'
import { createClient } from '@/lib/supabase/client'
import { startGitHubSignIn } from '@/components/SignInButton'
import { MenuItem } from '@/components/ui/menu-item'

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

// Top-right pill: Share (anon + signed-in) plus Sign in (anon) / Sign out
// (signed-in). No positioning of its own — the parent (Canvas.tsx's
// top-right corner block) owns placement via a pill-cluster.
//
// The Share button is a single visible button that reveals a two-item
// hover menu (Copy link / Copy TikZ code) — a quick-copy shortcut, distinct
// from the top-right Export button's full panel+preview (TikzExportPanel).
export default function AuthSharePill({ isSignedIn, callbackUrl, shareBase }: Props) {
  const [copied, setCopied] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openMenu = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setMenuOpen(true)
  }
  const scheduleClose = () => {
    closeTimer.current = setTimeout(() => setMenuOpen(false), 150)
  }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])

  // Click-outside close — hover handles the mouse case, but a tap (no
  // hover) needs this to dismiss the menu too.
  useEffect(() => {
    if (!menuOpen) return
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [menuOpen])

  const flashCopied = () => {
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('Copy this:', text)
      return
    }
    flashCopied()
  }

  const onCopyLink = async () => {
    setMenuOpen(false)
    const diagram = useStore.getState().diagram
    const frag = await encodeDiagramToFragment(diagram)
    const u = new URL(shareBase, location.origin)
    await copyText(`${u.href}#${frag}`)
  }

  const onCopyTikz = async () => {
    setMenuOpen(false)
    const diagram = useStore.getState().diagram
    const tex = await diagramToTikz(diagram)
    await copyText(tex)
  }

  const onSignOut = async () => {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign('/')
  }

  return (
    <div className="pill editor-pill">
      <div ref={wrapRef} style={{ position: 'relative' }} onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
        <button
          className="btn btn-icon"
          title={copied ? 'Copied' : 'Share'}
          aria-label="Share"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((v) => !v)}
        >
          {copied ? <CheckIcon /> : <ShareIcon />}
        </button>
        {menuOpen && (
          <div
            role="menu"
            style={{
              position: 'absolute', top: '100%', right: 0, marginTop: 8, zIndex: 20,
              background: 'var(--color-card)', border: '1px solid var(--color-border)',
              borderRadius: 'var(--radius-md, 10px)', boxShadow: 'var(--shadow-md)', padding: 6,
            }}
          >
            <MenuItem onClick={onCopyLink}>Copy link</MenuItem>
            <MenuItem onClick={onCopyTikz}>Copy TikZ code</MenuItem>
          </div>
        )}
      </div>
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
