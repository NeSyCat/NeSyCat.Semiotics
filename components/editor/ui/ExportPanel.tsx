'use client'

// Export panel — a right-edge slide-in replacing the old ExportMenu
// dropdown. Tabs switch between the formats the editor can emit; the code
// area renders a line-numbered, syntax-highlighted view via the local
// dependency-free tokenizer in `../export/highlight`. A Copy button mirrors
// ExportMenu's copy idiom (clipboard write, `window.prompt` fallback,
// checkmark feedback).

import { useEffect, useState } from 'react'
import { encodeDiagramToFragment } from '../persist/share'
import { diagramToTikz } from '../export/tikz'
import { diagramToHtml } from '../export/html'
import { diagramToPrisma } from '../export/prisma'
import { highlight, type HighlightLang, type TokenKind } from '../export/highlight'
import type { Diagram } from '../domain/types'
import { panelStyle } from './theme'

interface Props {
  diagram: Diagram
  onClose: () => void
}

function CloseIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
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

// The ID-LESS editor base — see ExportMenu's (now deleted) original comment
// for why this can't just be `location.pathname`: on a signed-in diagram
// page the pathname carries the private row id, which a recipient's RLS
// can't resolve. Every host that serves the editor is either single-host/
// preview (paths under /editor) or the production subdomain (paths at /),
// so the path prefix alone decides.
function shareBasePath(): string {
  return location.pathname.startsWith('/editor') ? '/editor' : '/'
}

// TODO: dark-theme palette — these are tuned for the light card background.
const KIND_COLOR: Record<TokenKind, string> = {
  plain: 'var(--color-foreground)',
  comment: '#6e7781',
  string: '#0a7d22',
  number: '#0550ae',
  keyword: '#cf222e',
  attr: '#8250df',
  type: '#0891b2',
  punct: '#57606a',
  tag: '#116329',
  property: '#0550ae',
  boolean: '#cf222e',
}

type Format = 'prisma' | 'latex' | 'html' | 'json' | 'url'

const TABS: { format: Format; label: string }[] = [
  { format: 'prisma', label: 'Prisma' },
  { format: 'latex', label: 'LaTeX' },
  { format: 'html', label: 'HTML' },
  { format: 'json', label: 'JSON' },
  { format: 'url', label: 'URL' },
]

// Maps a code format to its highlighter language — URL isn't code, so it
// has no entry (handled separately as plain wrapped text).
const HIGHLIGHT_LANG: Partial<Record<Format, HighlightLang>> = {
  prisma: 'prisma', latex: 'latex', html: 'html', json: 'json',
}

export default function ExportPanel({ diagram, onClose }: Props) {
  const [shown, setShown] = useState(false)
  const [format, setFormat] = useState<Format>('prisma')
  const [text, setText] = useState('')
  const [copied, setCopied] = useState(false)

  useEffect(() => setShown(true), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Computes the text for the active format. Prisma/JSON are synchronous;
  // LaTeX/HTML/URL are async (LaTeX and HTML embed the share fragment, URL
  // IS the share fragment) — all three are guarded against races with a
  // local `cancelled` flag in case the user flips tabs mid-encode.
  useEffect(() => {
    let cancelled = false
    if (format === 'url') {
      encodeDiagramToFragment(diagram).then((frag) => {
        if (cancelled) return
        setText(`${location.origin}${shareBasePath()}#${frag}`)
      })
    } else if (format === 'prisma') {
      setText(diagramToPrisma(diagram))
    } else if (format === 'latex') {
      diagramToTikz(diagram).then((t) => { if (!cancelled) setText(t) })
    } else if (format === 'html') {
      diagramToHtml(diagram).then((t) => { if (!cancelled) setText(t) })
    } else if (format === 'json') {
      setText(JSON.stringify(diagram, null, 2))
    }
    return () => { cancelled = true }
  }, [format, diagram])

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      window.prompt('Copy this:', text)
      return
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 1200)
  }

  const lang = HIGHLIGHT_LANG[format]
  const lines = text.split('\n')

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        background: 'rgba(0,0,0,0.18)',
      }}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div
        style={{
          ...panelStyle(),
          position: 'fixed', top: 0, right: 0, height: '100vh', width: 'min(560px, 92vw)',
          display: 'flex', flexDirection: 'column',
          borderRadius: 0,
          borderTop: 'none', borderRight: 'none', borderBottom: 'none',
          transform: shown ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 240ms cubic-bezier(0.22,1,0.36,1)',
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* Header: title + close */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', flexShrink: 0 }}>
          <span style={{ fontFamily: 'var(--font-sans, system-ui, sans-serif)', fontSize: 14, fontWeight: 500, color: 'var(--color-foreground)' }}>
            Export
          </span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <button
              className="btn btn-icon"
              title={copied ? 'Copied' : 'Copy'}
              aria-label={copied ? 'Copied' : 'Copy'}
              onClick={onCopy}
            >
              {copied
                ? <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#ic-check" /></svg>
                : (
                  <svg width={16} height={16} viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <rect x="8" y="8" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
                    <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
            </button>
            <button className="btn btn-icon" title="Close" aria-label="Close" onClick={onClose}>
              <CloseIcon />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, padding: '0 12px 10px', flexShrink: 0 }}>
          {TABS.map(({ format: f, label }) => {
            const active = f === format
            return (
              <button
                key={f}
                onClick={() => setFormat(f)}
                style={{
                  fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12,
                  padding: '4px 10px', borderRadius: 'var(--radius-sm, 6px)', border: 'none', cursor: 'pointer',
                  background: active ? 'var(--color-hover)' : 'transparent',
                  color: active ? 'var(--color-foreground)' : 'var(--color-muted-foreground)',
                }}
              >
                {label}
              </button>
            )
          })}
        </div>

        {/* Code area */}
        <div
          style={{
            flex: 1, minHeight: 0, overflow: 'auto',
            fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 12.5, lineHeight: 1.6,
            background: 'var(--color-background)',
          }}
        >
          {lang ? (
            <div style={{ display: 'flex' }}>
              <div
                style={{
                  position: 'sticky', left: 0,
                  padding: '10px 8px 10px 12px',
                  textAlign: 'right', userSelect: 'none',
                  color: 'var(--color-muted-foreground)',
                  background: 'var(--color-background)',
                  whiteSpace: 'pre',
                }}
              >
                {lines.map((_, i) => i + 1).join('\n')}
              </div>
              <pre style={{ margin: 0, padding: '10px 12px 10px 0', whiteSpace: 'pre' }}>
                {highlight(text, lang).map((t, i) => (
                  <span key={i} style={{ color: KIND_COLOR[t.kind] }}>{t.text}</span>
                ))}
              </pre>
            </div>
          ) : (
            <div style={{ padding: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-foreground)' }}>
              {text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
