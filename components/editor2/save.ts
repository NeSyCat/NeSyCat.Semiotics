'use client'

import { useEffect, useRef } from 'react'
import { useStore, isHydrating } from './store'
import { saveDiagram } from '@/lib/actions/diagrams'
import { restoreDiagram } from './io'
import { encodeJsonToFragment } from './share'
import type { Diagram } from './types'

const DEBOUNCE_MS = 300

export const LOCAL_DRAFT_KEY = 'nesycat.editor.draft'

// Shared debounce/dedupe/hydration-skip/pagehide-flush machinery behind
// both the server-action autosave and the localStorage draft sink: subscribes
// to store diagram changes, debounces, dedupes by serialized JSON, skips the
// hydration swap (so cross-diagram navigation doesn't write the new diagram
// back to the old key), and flushes on unload. `sink` receives the
// already-computed JSON string (so callers never double-stringify) plus the
// snapshot it was computed from.
function useDebouncedDiagramSink(key: string | null, sink: (json: string, snapshot: Diagram) => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Diagram | null>(null)
  const lastSavedJsonRef = useRef<string | null>(null)

  useEffect(() => {
    if (!key) return

    lastSavedJsonRef.current = JSON.stringify(useStore.getState().diagram)

    const flush = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const snapshot = pendingRef.current
      if (!snapshot) return
      pendingRef.current = null
      const json = JSON.stringify(snapshot)
      if (json === lastSavedJsonRef.current) return
      lastSavedJsonRef.current = json
      sink(json, snapshot)
    }

    const unsub = useStore.subscribe((state, prev) => {
      if (state.diagram === prev.diagram) return
      if (isHydrating()) return
      pendingRef.current = state.diagram
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(flush, DEBOUNCE_MS)
    })

    const onHide = () => flush()
    window.addEventListener('pagehide', onHide)
    window.addEventListener('beforeunload', onHide)

    return () => {
      unsub()
      window.removeEventListener('pagehide', onHide)
      window.removeEventListener('beforeunload', onHide)
      flush()
    }
  }, [key]) // eslint-disable-line react-hooks/exhaustive-deps
}

// Autosave: debounced, deduped writes to the DB via the saveDiagram server
// action. Signature and behavior unchanged from before the sink extraction.
export function useAutosave(diagramId: string | null) {
  useDebouncedDiagramSink(diagramId, (_json, snapshot) => {
    saveDiagram(diagramId as string, snapshot).catch((err) => {
      console.error('saveDiagram failed', err)
    })
  })
}

// Quiver-style URL sync: every debounced edit rewrites the fragment via
// history.replaceState, so the address bar always encodes the diagram on
// screen — refresh reproduces it exactly, and copying the URL is sharing.
// An empty canvas clears the fragment instead. Encoding is async (deflate),
// so a sequence counter drops out-of-order writes; a stale hash after the
// final pagehide flush is harmless because the localStorage draft, not the
// URL, is what an unadorned revisit loads.
let hashWriteSeq = 0
function syncHashFragment(json: string, snapshot: Diagram) {
  const seq = ++hashWriteSeq
  const isEmpty =
    snapshot.forms.length === 0 && snapshot.lines.length === 0 && Object.keys(snapshot.points).length === 0
  if (isEmpty) {
    history.replaceState(null, '', location.pathname + location.search)
    return
  }
  encodeJsonToFragment(json)
    .then((frag) => {
      if (seq !== hashWriteSeq) return
      history.replaceState(null, '', `#${frag}`)
    })
    .catch(() => {
      // Encoding failure leaves the previous URL in place — draft still saves.
    })
}

// Anonymous local draft: same debounce/dedupe/flush behavior, writing to
// localStorage instead of the DB (try/catch-swallowed, matching Canvas.tsx's
// existing localStorage idiom, so a disabled/full localStorage never breaks
// the editor) — and mirroring every write into the URL fragment.
export function useLocalAutosave(enabled: boolean) {
  useDebouncedDiagramSink(enabled ? LOCAL_DRAFT_KEY : null, (json, snapshot) => {
    try {
      localStorage.setItem(LOCAL_DRAFT_KEY, json)
    } catch {
      // localStorage disabled/full — editor keeps working in-memory.
    }
    syncHashFragment(json, snapshot)
  })
}

export function loadLocalDraft(): Diagram | null {
  try {
    const raw = localStorage.getItem(LOCAL_DRAFT_KEY)
    if (!raw) return null
    return restoreDiagram(JSON.parse(raw))
  } catch {
    return null
  }
}
