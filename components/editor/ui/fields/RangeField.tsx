'use client'

import { useState, useEffect } from 'react'

// Slider drags snap to marked values when within this many units, so landing
// on an exact mark is easy without fighting the mouse. Shared by both the
// Rotation field's right-angle marks and the Scale field's round-hundred
// marks — both originally used the exact same tolerance value.
const SNAP_TOLERANCE = 12
function snapToMark(v: number, marks: number[]): number {
  const hit = marks.find((m) => Math.abs(v - m) <= SNAP_TOLERANCE)
  return hit === undefined ? v : hit
}

// The Rotation/Scale categories' second pill — a bounded slider over the
// selected form(s) (mirrors the mockup's bounds slider), plus a directly-
// editable numeric readout. `sig` re-seeds the field when the selection
// changes, same coalescing-drag pattern as NameField.
//
// Merges the near-twin RotationField/ScaleField: identical slider+readout
// shell, differing only in bounds/step/unit and in how a raw drag value is
// normalized before committing —
//   • Rotation (min=0, max=360, wrap=true): the slider's right edge is a
//     real, reachable 360 (not silently folded into 0) so a full-turn drag
//     doesn't visually snap backwards mid-gesture — 360 and 0 are the same
//     rotation, but only the STORED value wraps (any nonzero multiple of
//     `max` reads as `max`, everything else wraps into [0, max)); the live
//     readout keeps whichever the user dragged to.
//   • Scale (min=25, max=400, wrap=false): plain clamping into [min, max].
export function RangeField({ sig, initial, disabled, onChange, min, max, step, unit, snapMarks, wrap, disabledValue }: {
  sig: string; initial: number; disabled: boolean; onChange: (v: number) => void
  min: number; max: number; step: number; unit: string; snapMarks: number[]; wrap: boolean; disabledValue: number
}) {
  const [val, setVal] = useState(initial)
  const [text, setText] = useState(String(initial))
  useEffect(() => { setVal(initial); setText(String(initial)) }, [sig]) // eslint-disable-line react-hooks/exhaustive-deps

  const apply = (raw: number) => {
    const rounded = Math.round(raw)
    const normalized = wrap
      ? (rounded !== 0 && rounded % max === 0 ? max : ((rounded % max) + max) % max)
      : Math.max(min, Math.min(max, rounded))
    setVal(normalized)
    setText(String(normalized))
    onChange(normalized)
  }
  const commitText = () => {
    const n = Number(text)
    if (Number.isFinite(n)) apply(n)
    else setText(String(val))
  }

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%', height: 36, padding: '0 14px', boxSizing: 'border-box' }}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        value={disabled ? disabledValue : val}
        onChange={(e) => apply(snapToMark(Number(e.target.value), snapMarks))}
        style={{ flex: 1 }}
      />
      <input
        type="text"
        inputMode="numeric"
        disabled={disabled}
        value={disabled ? '—' : text}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={commitText}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
          if (e.key === 'Escape') { setText(String(val)); (e.target as HTMLInputElement).blur() }
        }}
        style={{
          width: 28, textAlign: 'right', fontSize: 13, fontVariantNumeric: 'tabular-nums',
          background: 'transparent', border: 'none', outline: 'none', padding: 0,
          color: disabled ? 'var(--color-muted-foreground)' : 'var(--color-foreground)',
          fontFamily: 'var(--font-sans, system-ui, sans-serif)',
        }}
      />
      <span style={{ fontSize: 13, color: disabled ? 'var(--color-muted-foreground)' : 'var(--color-foreground)' }}>{unit}</span>
    </div>
  )
}
