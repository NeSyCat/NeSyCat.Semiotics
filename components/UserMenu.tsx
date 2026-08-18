'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { Me } from '@/lib/actions/organizations'
import OrgSettings from './OrgSettings'

interface Props {
  // callbackUrl mirrors AuthSharePill's prop shape (both pills are
  // interchangeable topRight slots), but UserMenu never needs it — a
  // signed-in user has nothing to sign IN to.
  me: Me
  // Computed server-side (resolveActiveOrg) so menu highlight, server, and
  // data agree — no client-side fallback/derivation here.
  activeOrgId: string | null
  callbackUrl: string
}

// The same person/account glyph AuthSharePill uses — one icon, no
// sign-in-vs-signed-in distinction needed here since UserMenu only ever
// renders signed-in.
function UserIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M4.5 19.5c0-3.6 3.36-6.5 7.5-6.5s7.5 2.9 7.5 6.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

// Door + arrow-out — distinct from UserIcon so the header's two buttons
// (open account menu vs. sign out) don't read as the same action twice.
function SignOutIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M9 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H9" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M20 12H10.5M20 12l-3.5-3.5M20 12l-3.5 3.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Settings gear — owner-only trigger that opens OrgSettings for an org row.
// A proper cog silhouette (toothed rim + center hub), NOT the previous
// circle-plus-radiating-spokes glyph — that one read as a sun (direct user
// complaint). The rim is one closed path: 8 square teeth (radial flanks +
// a flat outer arc each) joined by root-radius arcs between them; the hub
// is a plain stroked circle, same two-shape construction as UserIcon's
// head+body. Sized/colored by the DS's own `.select-option-action svg` rule
// (select.css); sprite.tsx has no gear symbol yet, so this lives locally
// like ExportMenu's CopyGlyph does.
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M 10.72 4.71 L 10.33 2.55 A 9.6 9.6 0 0 1 13.67 2.55 L 13.28 4.71 A 7.4 7.4 0 0 1 16.24 5.94 L 17.51 4.14 A 9.6 9.6 0 0 1 19.86 6.49 L 18.06 7.76 A 7.4 7.4 0 0 1 19.29 10.72 L 21.45 10.33 A 9.6 9.6 0 0 1 21.45 13.67 L 19.29 13.28 A 7.4 7.4 0 0 1 18.06 16.24 L 19.86 17.51 A 9.6 9.6 0 0 1 17.51 19.86 L 16.24 18.06 A 7.4 7.4 0 0 1 13.28 19.29 L 13.67 21.45 A 9.6 9.6 0 0 1 10.33 21.45 L 10.72 19.29 A 7.4 7.4 0 0 1 7.76 18.06 L 6.49 19.86 A 9.6 9.6 0 0 1 4.14 17.51 L 5.94 16.24 A 7.4 7.4 0 0 1 4.71 13.28 L 2.55 13.67 A 9.6 9.6 0 0 1 2.55 10.33 L 4.71 10.72 A 7.4 7.4 0 0 1 5.94 7.76 L 4.14 6.49 A 9.6 9.6 0 0 1 6.49 4.14 L 7.76 5.94 A 7.4 7.4 0 0 1 10.72 4.71 Z"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx="12" cy="12" r="2.6" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  )
}

// Top-right account pill for signed-in users — replaces AuthSharePill's
// signed-in branch. Same pill/btn trigger idiom, ExportMenu-style dropdown
// mechanics (open state, outside-click close, absolute right-aligned panel —
// this component's own root carries position:relative, same reasoning as
// TopRightPills' comment on the import/export pill: the panel's `right: 0`
// must align with THIS pill's right edge). Content: identity + sign-out,
// then an "Organizations" section — click a row to switch (cookie write +
// navigate to /editor, since diagram lists are org-scoped now and switching
// must leave the current diagram), gear-icon on rows the user owns opens
// OrgSettings (rename lives inside that panel now, not inline here).
export default function UserMenu({ me, activeOrgId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Which org's settings panel is open, if any. Just the id — the panel's
  // own props (name) are looked up from `me.memberships` below so there's a
  // single source of truth for org names (this component never edits it
  // directly; OrgSettings calls renameOrganization + router.refresh(), which
  // re-renders this component with the fresh me.memberships).
  const [settingsOrgId, setSettingsOrgId] = useState<string | null>(null)
  const settingsOrg = me.memberships.find((m) => m.organizationId === settingsOrgId) ?? null

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as HTMLElement)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  function switchOrg(id: string) {
    // document.cookie's setter trips the React Compiler's immutability rule
    // (it flags any assignment into `document.*`), but this is a plain
    // browser API write, not component state — false positive.
    // eslint-disable-next-line react-hooks/immutability
    document.cookie = `nesycat-active-org=${id}; path=/; max-age=31536000; samesite=lax`
    router.push('/editor')
    router.refresh()
  }

  async function onSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign('/')
  }

  return (
    <div ref={wrapRef} className="pill editor-pill" style={{ position: 'relative' }}>
      <button
        className="btn btn-icon"
        title="Account"
        aria-label="Account"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <UserIcon />
      </button>
      {open && (
        <div role="menu" className="user-menu-popover">
          <div className="user-menu-head">
            <div className="user-menu-identity">
              <div className="user-menu-name">{me.displayName}</div>
              <div className="user-menu-email">{me.email}</div>
            </div>
            <div className="pill">
              <button className="btn btn-icon" title="Sign out" aria-label="Sign out" onClick={() => void onSignOut()}>
                <SignOutIcon />
              </button>
            </div>
          </div>

          <div className="user-menu-label">Organizations</div>
          {me.memberships.map((m) => {
            const active = m.organizationId === activeOrgId
            return (
              <div
                key={m.organizationId}
                className={`select-option select-option--row${active ? ' is-selected' : ''}`}
              >
                <button type="button" className="select-option-label" onClick={() => switchOrg(m.organizationId)}>
                  {m.organizationName}
                </button>
                {m.isOwner && (
                  <button
                    type="button"
                    className="select-option-action"
                    title={`Settings for ${m.organizationName}`}
                    aria-label={`Settings for ${m.organizationName}`}
                    onClick={() => {
                      setSettingsOrgId(m.organizationId)
                      setOpen(false)
                    }}
                  >
                    <GearIcon />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
      {settingsOrg && (
        <OrgSettings
          organizationId={settingsOrg.organizationId}
          organizationName={settingsOrg.organizationName}
          onClose={() => setSettingsOrgId(null)}
        />
      )}
    </div>
  )
}
