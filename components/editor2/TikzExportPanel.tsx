'use client'

// Export-to-TikZ panel — a fixed overlay opened from the top-right pill
// cluster's export button (Canvas.tsx). Shows the generated code in a
// monospace scrollable box with a Copy button; Escape or an outside click
// closes it. Visual language matches the pill/panel idiom elsewhere
// (AuthSharePill's .pill/.btn, theme.ts's panelStyle).

import { useEffect, useState } from 'react'
import theme, { panelStyle } from './theme'
import { diagramToTikz } from './tikz'
import type { Diagram } from './types'

interface Props {
  diagram: Diagram
  onClose: () => void
}

function CopyIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
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

function CloseIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export default function TikzExportPanel({ diagram, onClose }: Props) {
  const [code, setCode] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    diagramToTikz(diagram).then((tex) => {
      if (!cancelled) setCode(tex)
    })
    return () => { cancelled = true }
  }, [diagram])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const onCopy = async () => {
    if (!code) return
    try {
      await navigator.clipboard.writeText(code)
    } catch {
      window.prompt('Copy this TikZ code:', code)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  return (
    <div
      // Fixed overlay + backdrop; a click on the backdrop itself (not its
      // children) closes the panel — same idiom as a plain modal.
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
          width: 'min(720px, 90vw)', maxHeight: '80vh',
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
            Export to TikZ
          </span>
          <div className="pill editor-pill">
            <button
              className="btn btn-icon"
              title={copied ? 'Copied' : 'Copy'}
              aria-label="Copy TikZ code"
              onClick={onCopy}
              disabled={!code}
            >
              {copied ? <CheckIcon /> : <CopyIcon />}
            </button>
            <button className="btn btn-icon" title="Close" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>
        <pre style={{
          margin: 0, padding: 16, overflow: 'auto', flex: 1,
          fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 13, lineHeight: 1.5,
          color: 'var(--color-foreground)', background: 'var(--color-background)', whiteSpace: 'pre',
        }}>
          {code ?? 'Generating…'}
        </pre>
      </div>
    </div>
  )
}
