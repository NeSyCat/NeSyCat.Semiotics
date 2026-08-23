'use client'

// Export panel — the Admination DS **Layout** (`.layout`) floating as an
// overlay: one `--color-card` surface with the DS **Bar** (`.bar`) floating on
// top. The DS owns all the chrome — the bar is transparent and the DS paints
// its soft glass haze via `.layout > .bar::before` (a masked gradient, so there
// is NO separate highlighted bar region / divider), and the body clears the bar
// with the DS `--layout-bar-height` token and scrolls UNDER it. We add only
// placement (the caller's job per layout.css) and the slide-in. Highlighting is
// Shiki (VS Code grammars + theme) via `../export/highlight`.

import { useEffect, useMemo, useState } from 'react'
import { encodeDiagramToFragment } from '../persist/share'
import { diagramToTikz } from '../export/tikz'
import { diagramToHtml } from '../export/html'
import { diagramToPrisma, diagramToPrismaPostgres } from '../export/prisma'
import { highlightToHtml, type HighlightLang } from '../export/highlight'
import type { Diagram } from '../domain/types'
import { CloseIcon, CopyGlyph } from './sprite'

// A VS Code-style coding monospace stack (ui-monospace/SF Mono on macOS). No
// web-font dependency.
const CODE_FONT = "ui-monospace, 'SF Mono', 'Cascadia Code', 'JetBrains Mono', Menlo, Consolas, 'Liberation Mono', monospace"

interface Props {
  diagram: Diagram
  onClose: () => void
}

// The ID-LESS editor base — a signed-in diagram pathname carries the private
// row id, which a recipient's RLS can't resolve; the path prefix alone decides.
function shareBasePath(): string {
  return location.pathname.startsWith('/editor') ? '/editor' : '/'
}

type Format = 'prisma' | 'postgres' | 'latex' | 'html' | 'json' | 'url'

const TABS: { format: Format; label: string }[] = [
  { format: 'prisma', label: 'Prisma' },
  { format: 'postgres', label: 'Postgres' },
  { format: 'latex', label: 'LaTeX' },
  { format: 'html', label: 'HTML' },
  { format: 'json', label: 'JSON' },
  { format: 'url', label: 'URL' },
]

// URL isn't code, so it has no highlighter language (rendered as plain text).
const HIGHLIGHT_LANG: Partial<Record<Format, HighlightLang>> = {
  prisma: 'prisma', postgres: 'prisma', latex: 'latex', html: 'html', json: 'json',
}

export default function ExportPanel({ diagram, onClose }: Props) {
  const [shown, setShown] = useState(false)
  const [format, setFormat] = useState<Format>('prisma')
  const [copied, setCopied] = useState(false)

  // rAF, not a bare effect setState — guarantees the off-screen frame paints
  // before we flip to shown, so the slide-in transition actually plays.
  useEffect(() => {
    const id = requestAnimationFrame(() => setShown(true))
    return () => cancelAnimationFrame(id)
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Sync formats are derived, not stored.
  const syncText = useMemo(() => {
    if (format === 'prisma') return diagramToPrisma(diagram)
    if (format === 'postgres') return diagramToPrismaPostgres(diagram)
    if (format === 'json') return JSON.stringify(diagram, null, 2)
    return null
  }, [format, diagram])

  // Async formats (LaTeX/HTML embed the share fragment; URL IS the fragment)
  // resolve into state tagged with the format they were computed for, so a
  // late result for a tab the user already left is never shown.
  const [asyncText, setAsyncText] = useState<{ format: Format; text: string } | null>(null)
  useEffect(() => {
    if (syncText !== null) return
    let cancelled = false
    const run =
      format === 'url' ? encodeDiagramToFragment(diagram).then((frag) => `${location.origin}${shareBasePath()}#${frag}`)
      : format === 'latex' ? diagramToTikz(diagram)
      : diagramToHtml(diagram)
    run.then((t) => { if (!cancelled) setAsyncText({ format, text: t }) })
    return () => { cancelled = true }
  }, [format, diagram, syncText])

  const pending = syncText === null && asyncText?.format !== format
  const text = syncText ?? (asyncText?.format === format ? asyncText.text : '')
  // Strip a single trailing newline so there's no dangling blank line; the
  // Copy button still copies the full original `text`.
  const body = text.endsWith('\n') ? text.slice(0, -1) : text
  const lang = HIGHLIGHT_LANG[format]

  // Shiki highlighting is async; tag the result with its format so a stale
  // result can't render on a tab the user already switched away from.
  const [highlighted, setHighlighted] = useState<{ format: Format; html: string } | null>(null)
  useEffect(() => {
    if (!lang || pending) return
    let cancelled = false
    highlightToHtml(body, lang).then((html) => { if (!cancelled) setHighlighted({ format, html }) })
    return () => { cancelled = true }
  }, [format, body, pending, lang])
  const codeReady = highlighted?.format === format

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

  return (
    <div
      className="layout"
      style={{
        // Placement + slide-in only — the caller's job per layout.css; every
        // surface/border/radius/shadow comes from `.layout` itself.
        position: 'fixed', top: 72, right: 16, bottom: 16, width: 'min(720px, 90vw)', zIndex: 100,
        transform: shown ? 'translateX(0)' : 'translateX(calc(100% + 24px))',
        transition: 'transform 240ms cubic-bezier(0.22,1,0.36,1)',
      }}
    >
      {/* DS Bar — a DIRECT child of .layout so the DS's `.layout > .bar::before`
          paints the fading glass haze behind the pills. Tabs left, actions right;
          the pills carry all the visual weight. */}
      <div className="bar">
        <div className="bar-left">
          {/* DS segmented control — plain .btn so every tab label stays visible
              (.btn-icon/.pill--tabs would collapse inactive tabs). */}
          <div className="pill">
            {TABS.map(({ format: f, label }) => (
              <button
                key={f}
                className={`btn${f === format ? ' is-active' : ''}`}
                onClick={() => setFormat(f)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="bar-center" />
        <div className="bar-right">
          <div className="pill-cluster">
            <div className="pill">
              <button
                className="btn btn-icon"
                title={copied ? 'Copied' : 'Copy'}
                aria-label={copied ? 'Copied' : 'Copy'}
                onClick={onCopy}
                disabled={pending}
              >
                {copied
                  ? <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#ic-check" /></svg>
                  : <CopyGlyph />}
              </button>
            </div>
            <div className="pill">
              <button className="btn btn-icon" title="Close" aria-label="Close" onClick={onClose}>
                <CloseIcon />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Body slot — a DIRECT child of .layout (gets flex:1 / min-height:0 from
          `.layout > :not(.bar)`). Its top padding is the DS bar-height token
          plus a small gap, so at rest the code starts a bit BELOW the bar (not
          under the pills) and scrolls under the bar's fading haze when scrolled. */}
      <div
        className="export-shiki"
        style={{
          overflow: 'auto',
          paddingTop: 'calc(var(--layout-bar-height) + 8px)',
          fontFamily: CODE_FONT, fontSize: 12.5, lineHeight: 1.6,
        }}
      >
        {pending || (lang && !codeReady) ? (
          <div style={{ padding: '0 14px 14px', color: 'var(--color-muted-foreground)' }}>Generating…</div>
        ) : lang ? (
          <div dangerouslySetInnerHTML={{ __html: highlighted!.html }} />
        ) : (
          <div style={{ padding: '0 14px 14px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--color-foreground)' }}>
            {body}
          </div>
        )}
      </div>
    </div>
  )
}
