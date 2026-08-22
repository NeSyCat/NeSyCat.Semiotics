'use client'

// Import panel — the round-trip counterpart to the top-right Export
// dropdown's "Copy URL" / "Copy TikZ code". Paste either a NeSyCat share
// link (or bare fragment) or TikZ code this editor exported; both round-trip
// through the same embedded share fragment (see importText.ts).
//
// Deliberately minimal, per direct user feedback: no header, no Cancel/
// Import text buttons — just the field and two icon buttons above it
// (cross = cancel, check = import).

import { useEffect, useState } from 'react'
import theme, { panelStyle } from './theme'
import { extractFragment } from '../export/importText'
import { decodeDiagramFromFragment } from '../persist/share'
import { useStore } from '../state/store'
import { CloseIcon, CheckIcon } from './sprite'

interface Props {
  onClose: () => void
}

export default function ImportPanel({ onClose }: Props) {
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onImport = async () => {
    const fragment = extractFragment(text)
    if (!fragment) {
      setError("Couldn't find a NeSyCat share link or exported TikZ in that text.")
      return
    }
    setBusy(true)
    setError(null)
    try {
      const diagram = await decodeDiagramFromFragment(fragment)
      if (!diagram) {
        setError('Found a link, but could not decode it — it may be corrupted or from a newer version.')
        return
      }
      useStore.getState().loadDiagram(diagram)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          ...panelStyle(),
          width: 'min(560px, 90vw)',
          borderRadius: 'var(--radius-lg, 16px)',
          padding: 10,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Cross (cancel) / check (import) — nothing else above the field. */}
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <div className="pill editor-pill">
            <button className="btn btn-icon" title="Cancel" aria-label="Cancel" onClick={onClose}>
              <CloseIcon />
            </button>
            <button
              className="btn btn-icon"
              title="Import"
              aria-label="Import"
              onClick={onImport}
              disabled={!text.trim() || busy}
            >
              <CheckIcon />
            </button>
          </div>
        </div>
        <textarea
          autoFocus
          value={text}
          onChange={(e) => { setText(e.target.value); setError(null) }}
          placeholder="Paste a NeSyCat share link, or TikZ exported from this editor…"
          rows={6}
          style={{
            width: '100%', boxSizing: 'border-box', resize: 'vertical',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12.5, lineHeight: 1.5,
            padding: 10, borderRadius: 'var(--radius-sm, 8px)',
            border: `1px solid ${theme.glass.borderColor}`, background: 'var(--color-background)',
            color: 'var(--color-foreground)',
          }}
        />
        {error && (
          <div style={{ fontSize: 12.5, color: 'var(--color-destructive, #d33)', fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}
