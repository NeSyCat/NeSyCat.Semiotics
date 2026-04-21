'use client'

import { useEffect, useState } from 'react'
import { Star } from 'lucide-react'
import Button from '@/components/ui/button'

// localStorage is the state store — no DB column needed, and a signed-in user
// who nukes their browser storage will just see the prompt again, which is fine.
const STORAGE_KEY = 'nesycat_star_state'
const INITIAL_DELAY_MS = 45 * 1000
const REMIND_AFTER_MS = 3 * 24 * 60 * 60 * 1000

type State = { clicked?: number; dismissedAt?: number } | null

function read(): State {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as State) : null
  } catch {
    return null
  }
}
function write(s: State) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(s))
  } catch {}
}

export default function StarPrompt({ repoUrl }: { repoUrl: string }) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const state = read()
    if (state?.clicked) return
    const wait = state?.dismissedAt
      ? Math.max(0, state.dismissedAt + REMIND_AFTER_MS - Date.now())
      : INITIAL_DELAY_MS
    const t = window.setTimeout(() => setOpen(true), wait)
    return () => window.clearTimeout(t)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  function star() {
    write({ clicked: Date.now() })
    window.open(repoUrl, '_blank', 'noopener,noreferrer')
    setOpen(false)
  }
  function dismiss() {
    write({ dismissedAt: Date.now() })
    setOpen(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={dismiss} aria-hidden />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="star-prompt-title"
        className="relative flex w-[min(92vw,420px)] flex-col gap-5 border p-7 backdrop-blur-[3px]"
        style={{
          background: 'var(--color-glass-panel-bg)',
          borderColor: 'var(--color-glass-border)',
          borderRadius: 'var(--size-radius-md)',
        }}
      >
        <div className="flex items-center gap-3">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full"
            style={{ background: 'rgba(var(--color-accent-rgb), 0.15)' }}
          >
            <Star
              size={20}
              className="text-[color:var(--color-accent-blue)]"
              fill="currentColor"
            />
          </div>
          <h2 id="star-prompt-title" className="t-h2">
            Enjoying NeSyCat?
          </h2>
        </div>
        <p className="t-body">
          If the editor is useful to you, a GitHub star would mean a lot — it helps others
          discover the project.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={dismiss}>
            Not now
          </Button>
          <Button variant="primary" onClick={star}>
            <Star size={14} fill="currentColor" style={{ marginRight: 6 }} />
            Star on GitHub
          </Button>
        </div>
      </div>
    </div>
  )
}
