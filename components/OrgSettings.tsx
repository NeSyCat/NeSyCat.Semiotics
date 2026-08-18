'use client'

// Org settings modal — opened from a UserMenu org row's owner-only gear.
// Overlay/panel mechanics mirror components/editor/ui/ImportPanel.tsx:
// fixed full-viewport scrim, mousedown-on-scrim-only close (stopPropagation
// on the panel), Escape via a window keydown listener. Three stacked
// sections (Organization / Members / Invite) built from the DS's own
// .section/-header/-body leaves; roster rows and badges get their own
// .org-settings-* classes in app/globals.css since the DS has no multi-line
// list-row component to reuse.
//
// Data: listOrgRoster on mount, re-fetched after every successful mutation
// (no optimistic local patching — the roster is small and mutations are
// infrequent, so a full reload keeps this simple and always server-true).

import { useEffect, useRef, useState, useTransition } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import {
  listOrgRoster,
  inviteMember,
  revokeInvitation,
  removeMember,
  setMemberOwner,
  renameOrganization,
  type OrgRoster,
} from '@/lib/actions/organizations'
import { XIcon, Spinner } from './icons'

interface Props {
  organizationId: string
  organizationName: string
  onClose: () => void
}

export default function OrgSettings({ organizationId, organizationName, onClose }: Props) {
  const router = useRouter()

  const [roster, setRoster] = useState<OrgRoster | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Name field — autosaves on blur/Enter, same commit-if-changed idiom as
  // DiagramItem's inline rename. lastSaved tracks what the server actually
  // has so a value edited then reverted back is a no-op, not a spurious write.
  const [name, setName] = useState(organizationName)
  const lastSavedName = useRef(organizationName)
  const [isSavingName, startNameTransition] = useTransition()
  const [nameError, setNameError] = useState<string | null>(null)
  const nameInputRef = useRef<HTMLInputElement>(null)

  // Invite field. inviteWarning is set instead of inviteSuccess when the
  // invitations row was written but the notification email could not be
  // sent (see inviteMember's ActionResult.warning) — the invite itself still
  // succeeded, so this renders in a non-alarming style, not as an error.
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [inviteSuccess, setInviteSuccess] = useState(false)
  const [inviteWarning, setInviteWarning] = useState<string | null>(null)
  const [isInviting, startInviteTransition] = useTransition()

  // Which roster action is in flight, if any — keys the specific row/button
  // being disabled (e.g. `member:${userId}:promote`) so one pending action
  // doesn't grey out every other row's controls.
  const [actingKey, setActingKey] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [, startActionTransition] = useTransition()

  // Used by the mutation handlers below (event-callback context, not an
  // effect) to refresh after a successful write.
  async function reload() {
    setLoadError(null)
    try {
      const r = await listOrgRoster(organizationId)
      setRoster(r)
    } catch {
      setLoadError('Could not load the member list.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    // Inlined rather than calling reload() directly: the react-hooks lint
    // rule (set-state-in-effect) flags reload()'s synchronous setLoadError
    // call as a same-tick setState-in-effect. This version only calls
    // setState from inside the .then/.catch/.finally callbacks — the
    // "subscribe to an external result" shape the rule wants — with a
    // `cancelled` guard against a fast unmount racing the fetch.
    let cancelled = false
    listOrgRoster(organizationId)
      .then((r) => { if (!cancelled) setRoster(r) })
      .catch(() => { if (!cancelled) setLoadError('Could not load the member list.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    nameInputRef.current?.focus()
    return () => { cancelled = true }
    // Only on mount — organizationId is stable for the lifetime of this
    // panel (a new org's settings is a fresh mount of the whole component,
    // since UserMenu conditionally renders it by settingsOrgId).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  function commitName() {
    const trimmed = name.trim() || 'Untitled'
    if (trimmed === lastSavedName.current) return
    startNameTransition(async () => {
      // Autosave still reports failure inline, like every other mutation
      // here — without this the rejected promise would surface nowhere and
      // the field would look saved when it wasn't.
      setNameError(null)
      const result = await renameOrganization(organizationId, trimmed)
      if (!result.ok) {
        setNameError(result.error)
        return
      }
      lastSavedName.current = trimmed
      router.refresh()
    })
  }

  function runAction(key: string, action: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setActingKey(key)
    setActionError(null)
    startActionTransition(async () => {
      const result = await action()
      if (!result.ok) setActionError(result.error)
      else await reload()
      setActingKey(null)
    })
  }

  function onInvite() {
    const email = inviteEmail.trim()
    if (!email || isInviting) return
    setInviteError(null)
    setInviteSuccess(false)
    setInviteWarning(null)
    startInviteTransition(async () => {
      const result = await inviteMember(organizationId, email)
      if (!result.ok) {
        setInviteError(result.error)
        return
      }
      setInviteEmail('')
      if (result.warning) setInviteWarning(result.warning)
      else setInviteSuccess(true)
      await reload()
    })
  }

  const owners = roster?.members.filter((m) => m.isOwner) ?? []
  const isLastOwner = (m: { isOwner: boolean }) => m.isOwner && owners.length <= 1

  // PORTAL, not a plain child: this modal is rendered from inside UserMenu,
  // which lives in a DS `.pill` — and `.pill` sets `backdrop-filter`, which
  // per spec makes it the containing block for `position: fixed` descendants.
  // Left in place the "full-viewport" scrim is positioned and clipped inside
  // that ~90px pill instead (the panel appears as a sliver in the top-right).
  // Rendering into document.body escapes it entirely.
  return createPortal(
    <div
      className="org-settings-overlay"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`${organizationName} settings`}
        className="org-settings-panel"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="org-settings-header">
          <h2 className="t-h2">Organization settings</h2>
          <div className="pill">
            <button className="btn btn-icon" title="Close" aria-label="Close" onClick={onClose}>
              <XIcon />
            </button>
          </div>
        </div>

        <div className="org-settings-body">
          <div className="section">
            <h3 className="section-header">Organization</h3>
            <div className="section-body">
              <div className="field">
                <label className="field-header" htmlFor="org-settings-name">Name</label>
                <input
                  id="org-settings-name"
                  ref={nameInputRef}
                  className="text"
                  value={name}
                  disabled={isSavingName}
                  onChange={(e) => setName(e.target.value)}
                  onBlur={commitName}
                  onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                />
                {nameError && <p className="org-settings-error">{nameError}</p>}
              </div>
            </div>
          </div>

          <div className="section">
            <h3 className="section-header">Members</h3>
            <div className="section-body">
              {loading ? (
                <div className="org-settings-hint" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Spinner /> Loading…
                </div>
              ) : loadError ? (
                <div className="org-settings-error">{loadError}</div>
              ) : (
                <>
                  {roster?.members.map((m) => {
                    const lastOwner = isLastOwner(m)
                    const promoteKey = `member:${m.userId}:owner`
                    const removeKey = `member:${m.userId}:remove`
                    return (
                      <div key={m.userId} className="org-settings-row">
                        <div className="org-settings-row-text">
                          <span className="org-settings-row-name">{m.displayName}</span>
                          <span className="org-settings-row-meta">{m.email}</span>
                        </div>
                        {m.isOwner && <span className="org-settings-badge org-settings-badge--owner">Owner</span>}
                        <div className="org-settings-row-actions">
                          <button
                            type="button"
                            className="btn"
                            disabled={actingKey === promoteKey || lastOwner}
                            title={lastOwner ? 'Organizations need at least one owner' : undefined}
                            onClick={() => runAction(promoteKey, () => setMemberOwner(organizationId, m.userId, !m.isOwner))}
                          >
                            {m.isOwner ? 'Remove owner' : 'Make owner'}
                          </button>
                          <button
                            type="button"
                            className="btn btn--danger"
                            disabled={actingKey === removeKey || lastOwner}
                            title={lastOwner ? 'Organizations need at least one owner' : undefined}
                            onClick={() => runAction(removeKey, () => removeMember(organizationId, m.userId))}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {roster?.invitations.map((inv) => {
                    const revokeKey = `invite:${inv.email}`
                    return (
                      <div key={inv.email} className="org-settings-row">
                        <div className="org-settings-row-text">
                          <span className="org-settings-row-name">{inv.email}</span>
                          <span className="org-settings-row-meta">joins on first sign-in</span>
                        </div>
                        <span className="org-settings-badge org-settings-badge--pending">Pending</span>
                        <div className="org-settings-row-actions">
                          <button
                            type="button"
                            className="btn"
                            disabled={actingKey === revokeKey}
                            onClick={() => runAction(revokeKey, () => revokeInvitation(organizationId, inv.email))}
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    )
                  })}
                  {actionError && <div className="org-settings-error">{actionError}</div>}
                </>
              )}
            </div>
          </div>

          <div className="section">
            <h3 className="section-header">Invite</h3>
            <div className="section-body">
              <div className="org-settings-invite-row">
                <input
                  className="text"
                  type="email"
                  placeholder="name@example.com"
                  value={inviteEmail}
                  disabled={isInviting}
                  onChange={(e) => { setInviteEmail(e.target.value); setInviteError(null); setInviteSuccess(false); setInviteWarning(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); onInvite() } }}
                />
                <button type="button" className="btn btn--primary" disabled={!inviteEmail.trim() || isInviting} onClick={onInvite}>
                  Invite
                </button>
              </div>
              {inviteError && <div className="org-settings-error">{inviteError}</div>}
              {inviteWarning && <div className="org-settings-warning">{inviteWarning}</div>}
              {inviteSuccess && <div className="org-settings-success">Invitation sent.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}
