'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { renameOrganization, type Me, type MeMembership } from '@/lib/actions/organizations'

interface Props {
  // callbackUrl mirrors AuthSharePill's prop shape (both pills are
  // interchangeable topRight slots), but UserMenu never needs it — a
  // signed-in user has nothing to sign IN to.
  me: Me
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

// Settings gear — owner-only inline-rename trigger on an org row. Sized/
// colored by the DS's own `.select-option-action svg` rule (select.css);
// sprite.tsx has no gear symbol yet, so this lives locally like ExportMenu's
// CopyGlyph does.
function GearIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.8" />
      <path
        d="M12 3v2.4M12 18.6V21M21 12h-2.4M5.4 12H3M18.1 5.9l-1.7 1.7M7.6 16.4l-1.7 1.7M18.1 18.1l-1.7-1.7M7.6 7.6L5.9 5.9"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function activeOrgStorageKey(userId: string): string {
  return `nesycat.semiotics.activeOrgId.${userId}`
}

// Top-right account pill for signed-in users — replaces AuthSharePill's
// signed-in branch. Same pill/btn trigger idiom, ExportMenu-style dropdown
// mechanics (open state, outside-click close, absolute right-aligned panel —
// this component's own root carries position:relative, same reasoning as
// TopRightPills' comment on the import/export pill: the panel's `right: 0`
// must align with THIS pill's right edge). Content: identity + sign-out,
// then an "Organizations" section — click a row to switch (pure client
// state, no reload — nothing is org-scoped yet), gear-icon inline rename on
// rows the user owns.
export default function UserMenu({ me }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Initialised from localStorage behind a `typeof window` guard: this
  // initializer also runs during SSR (client components still render
  // server-side for the first paint), where `window` doesn't exist.
  const [activeOrgId, setActiveOrgId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(activeOrgStorageKey(me.userId))
  })

  const [renamingId, setRenamingId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const [isRenaming, startRenameTransition] = useTransition()

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as HTMLElement)) {
        setOpen(false)
        setRenamingId(null)
      }
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  // me.memberships is server-ordered by name; the stored id wins only while
  // it still names a real membership (an org can be renamed/left elsewhere),
  // else fall back to the first membership by name — same fallback rule as
  // the design doc.
  const activeId =
    activeOrgId && me.memberships.some((m) => m.organizationId === activeOrgId)
      ? activeOrgId
      : (me.memberships[0]?.organizationId ?? null)

  function switchOrg(id: string) {
    setActiveOrgId(id)
    window.localStorage.setItem(activeOrgStorageKey(me.userId), id)
  }

  async function onSignOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    window.location.assign('/')
  }

  function startRename(m: MeMembership) {
    setRenamingId(m.organizationId)
    setRenameValue(m.organizationName)
  }

  function commitRename(id: string) {
    const value = renameValue
    setRenamingId(null)
    startRenameTransition(async () => {
      await renameOrganization(id, value)
      router.refresh()
    })
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
            const active = m.organizationId === activeId
            const editing = renamingId === m.organizationId
            return (
              <div
                key={m.organizationId}
                className={`select-option select-option--row${active ? ' is-selected' : ''}`}
              >
                {editing ? (
                  <input
                    className="user-menu-rename-input"
                    value={renameValue}
                    autoFocus
                    disabled={isRenaming}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename(m.organizationId) }
                      else if (e.key === 'Escape') { e.preventDefault(); setRenamingId(null) }
                    }}
                  />
                ) : (
                  <button type="button" className="select-option-label" onClick={() => switchOrg(m.organizationId)}>
                    {m.organizationName}
                  </button>
                )}
                {m.isOwner && !editing && (
                  <button
                    type="button"
                    className="select-option-action"
                    title={`Rename ${m.organizationName}`}
                    aria-label={`Rename ${m.organizationName}`}
                    onClick={() => startRename(m)}
                  >
                    <GearIcon />
                  </button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
