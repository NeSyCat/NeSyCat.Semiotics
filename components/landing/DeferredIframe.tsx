'use client'

import { useEffect, useState } from 'react'

interface Props {
  src: string
  title: string
  style?: React.CSSProperties
  className?: string
}

// Holds off on loading the iframe until the host page has painted and the
// main thread is idle. Landing-page hero preview is ~500KB of JS that would
// otherwise block the Load event for >1s.
export default function DeferredIframe({ src, title, style, className }: Props) {
  const [load, setLoad] = useState(false)

  useEffect(() => {
    type RIC = (cb: () => void, opts?: { timeout?: number }) => number
    const w = window as unknown as { requestIdleCallback?: RIC }
    if (w.requestIdleCallback) {
      const handle = w.requestIdleCallback(() => setLoad(true), { timeout: 800 })
      return () => {
        const cancel = (window as unknown as { cancelIdleCallback?: (h: number) => void }).cancelIdleCallback
        if (cancel) cancel(handle)
      }
    }
    const t = setTimeout(() => setLoad(true), 400)
    return () => clearTimeout(t)
  }, [])

  if (!load) {
    return (
      <div
        className={className}
        style={{
          ...style,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--color-text-dimmed)',
          fontSize: 12,
          gap: 10,
        }}
      >
        <svg
          width={18}
          height={18}
          viewBox="0 0 24 24"
          fill="none"
          aria-hidden
          style={{ animation: 'spin 0.9s linear infinite', color: 'var(--color-accent-blue)' }}
        >
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        <span>Loading preview…</span>
      </div>
    )
  }

  return <iframe src={src} title={title} style={style} className={className} />
}
