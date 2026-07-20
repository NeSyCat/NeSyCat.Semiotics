'use client'

import { useState, useRef, useEffect } from 'react'
import { encodeDiagramToFragment } from '../persist/share'
import { diagramToTikz } from '../export/tikz'
import { diagramToHtml } from '../export/html'
import type { Diagram } from '../domain/types'
import { CopyGlyph } from './sprite'

// One row of the Export dropdown — a label (monospace, "$...$"-free plain
// text, not KaTeX — this is chrome, not diagram content) on the left, a
// copy icon on the right; the whole row is clickable. Swaps to a checkmark
// briefly after a successful copy, per-row (independent of its siblings).
function ExportRow({ label, getText }: { label: string; getText: () => Promise<string> }) {
  const [copied, setCopied] = useState(false)
  const onClick = async () => {
    const text = await getText()
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
    <button
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20,
        width: '100%', height: 30, padding: '0 8px', border: 'none', background: 'transparent', cursor: 'pointer',
        borderRadius: 'var(--radius-sm, 6px)', color: 'var(--color-foreground)',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--color-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{ fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: 13 }}>{label}</span>
      {copied ? <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true"><use href="#ic-check" /></svg> : <CopyGlyph />}
    </button>
  )
}

// The Export button's hover/click dropdown — narrow, three rows (URL / Text
// / HTML), each just a label + copy icon. Deliberately NOT a code-preview
// panel: same round-trip-copy idiom the Import button pairs with.
//
// The copied URL must use the ID-LESS editor base (editor-url.ts's
// serverEditorHref() with no id) — NOT the current pathname: on a signed-in
// diagram page the pathname is /editor/<id> (or /<id> on the subdomain),
// and a recipient opening that path hits the owner's RLS-guarded row — 404
// for signed-in recipients, whose ImportSharedHash never mounts across the
// not-found boundary (it also leaks the private row id). The base path is
// what both import flows listen on. Client-side derivation of that base:
// every host that serves the editor is either single-host/preview (paths
// under /editor) or the production subdomain (paths at /), so the prefix
// alone decides — same output as editorHrefForHost(host) for those hosts.
function shareBasePath(): string {
  return location.pathname.startsWith('/editor') ? '/editor' : '/'
}

export function ExportMenu({ diagram }: { diagram: Diagram }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const openMenu = () => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
    setOpen(true)
  }
  const scheduleClose = () => { closeTimer.current = setTimeout(() => setOpen(false), 150) }
  useEffect(() => () => { if (closeTimer.current) clearTimeout(closeTimer.current) }, [])
  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      // Cast to HTMLElement, not the DOM `Node` type — Canvas.tsx (this
      // component's original home) shadows the ambient DOM one with React
      // Flow's OWN `Node` (the flow-graph node type); kept as HTMLElement
      // here too for behavioral parity.
      if (wrapRef.current && !wrapRef.current.contains(e.target as HTMLElement)) setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [open])

  return (
    <div ref={wrapRef} onMouseEnter={openMenu} onMouseLeave={scheduleClose}>
      <button
        className="btn btn-icon"
        title="Export"
        aria-label="Export"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg aria-hidden="true"><use href="#ic-export" /></svg>
      </button>
      {open && (
        <div
          role="menu"
          style={{
            position: 'absolute', top: '100%', right: 0, marginTop: 8, zIndex: 20, minWidth: 116,
            background: 'var(--color-card)', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md, 10px)', boxShadow: 'var(--shadow-md)', padding: 4,
            display: 'flex', flexDirection: 'column',
          }}
        >
          <ExportRow label="LaTeX" getText={() => diagramToTikz(diagram)} />
          <ExportRow
            label="URL"
            getText={async () => {
              const frag = await encodeDiagramToFragment(diagram)
              return `${location.origin}${shareBasePath()}#${frag}`
            }}
          />
          <ExportRow label="HTML" getText={() => diagramToHtml(diagram)} />
        </div>
      )}
    </div>
  )
}
