'use client'

import { useEffect, useRef, useState } from 'react'
import type { EdgeStyle } from '../../domain/wirepath'

// One row per EdgeStyle, in the order they appear in the dropdown.
const OPTIONS: ReadonlyArray<{ key: EdgeStyle; label: string; icon: string }> = [
  { key: 'straight', label: 'Straight', icon: 'ic-wire-straight' },
  { key: 'bezier', label: 'Bezier', icon: 'ic-wire-bezier' },
  { key: 'smoothstep', label: 'Step', icon: 'ic-wire-step' },
]

// Toolbar control for the diagram's wire style (domain/wirepath.ts's
// EdgeStyle) — a `btn btn-icon` trigger showing the CURRENT style, opening a
// small dropdown to pick a different one. Mechanics mirror components/
// UserMenu.tsx (useState/useRef open flag, mousedown-outside + Escape close);
// visuals reuse the DS's own `.user-menu-popover`/`.select-option` leaves
// (app/globals.css/vendor select.css) exactly as UserMenu does, so no new
// CSS is needed — icon+label layout inside each row is inline flex instead.
export function WireStyleMenu({
  edgeStyle, setEdgeStyle,
}: {
  edgeStyle: EdgeStyle
  setEdgeStyle: (style: EdgeStyle) => void
}) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as HTMLElement)) setOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDocDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onDocDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  const active = OPTIONS.find((o) => o.key === edgeStyle) ?? OPTIONS[0]

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        className={`btn btn-icon${open ? ' is-active' : ''}`}
        title={`Wire style: ${active.label}`}
        aria-label="Wire style"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg aria-hidden="true"><use href={`#${active.icon}`} /></svg>
      </button>
      {open && (
        <div role="menu" aria-label="Wire style" className="user-menu-popover">
          <div className="user-menu-label">Wire style</div>
          {OPTIONS.map((opt) => {
            const checked = opt.key === edgeStyle
            return (
              <button
                key={opt.key}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                className={`select-option${checked ? ' is-selected' : ''}`}
                style={{ display: 'flex', alignItems: 'center', gap: 8 }}
                onClick={() => { setEdgeStyle(opt.key); setOpen(false) }}
              >
                <svg aria-hidden="true" width={16} height={16} style={{ flex: 'none' }}>
                  <use href={`#${opt.icon}`} />
                </svg>
                <span>{opt.label}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
