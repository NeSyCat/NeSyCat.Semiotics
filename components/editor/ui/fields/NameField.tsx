'use client'

import { useState, useEffect } from 'react'

// The Name category's second pill — the whole pill is a text input that renames
// the current selection live (one undo step, via the store's coalescing). `sig`
// changes when the selection changes, re-seeding the field.
export function NameField({ sig, initial, placeholder, disabled, onChange }: {
  sig: string; initial: string; placeholder: string; disabled: boolean; onChange: (v: string) => void
}) {
  const [val, setVal] = useState(initial)
  useEffect(() => { setVal(initial) }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <input
      type="text"
      autoFocus
      disabled={disabled}
      value={disabled ? '' : val}
      placeholder={placeholder}
      onChange={(e) => { setVal(e.target.value); onChange(e.target.value) }}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur() }}
      style={{
        width: '100%', height: 36, boxSizing: 'border-box',
        background: 'transparent', border: 'none', outline: 'none',
        fontSize: 14, padding: '0 12px', color: 'var(--color-foreground)',
        fontFamily: 'var(--font-sans, system-ui, sans-serif)',
      }}
    />
  )
}
