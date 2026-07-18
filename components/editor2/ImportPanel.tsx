'use client'

// Import panel — the round-trip counterpart to TikzExportPanel. Paste
// either a NeSyCat share link (or bare fragment) or TikZ code this editor
// exported; both round-trip through the same embedded share fragment (see
// importText.ts). Same fixed-overlay/panel visual language as the export
// panel.

import { useEffect, useState } from 'react'
import theme, { panelStyle } from './theme'
import { extractFragment } from './importText'
import { decodeDiagramFromFragment } from './share'
import { useStore } from './store'

interface Props {
  onClose: () => void
}

function CloseIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
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
          display: 'flex', flexDirection: 'column', overflow: 'hidden',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '10px 14px', borderBottom: `1px solid ${theme.glass.borderColor}`,
        }}>
          <span style={{
            fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontWeight: 600,
            fontSize: 14, color: 'var(--color-foreground)',
          }}>
            Import
          </span>
          <div className="pill editor-pill">
            <button className="btn btn-icon" title="Close" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
            <div style={{ fontSize: 13, color: 'var(--color-destructive, #d33)', fontFamily: 'var(--font-sans, system-ui, sans-serif)' }}>
              {error}
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <button
              className="btn"
              onClick={onClose}
              style={{
                height: 32, padding: '0 14px', borderRadius: 9999, border: 'none', cursor: 'pointer',
                background: 'transparent', color: 'var(--color-foreground)',
                fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontSize: 13,
              }}
            >
              Cancel
            </button>
            <button
              className="btn"
              onClick={onImport}
              disabled={!text.trim() || busy}
              style={{
                height: 32, padding: '0 16px', borderRadius: 9999, border: 'none',
                cursor: !text.trim() || busy ? 'default' : 'pointer',
                background: 'var(--color-primary)', color: '#fff', opacity: !text.trim() || busy ? 0.5 : 1,
                fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontSize: 13, fontWeight: 600,
              }}
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
