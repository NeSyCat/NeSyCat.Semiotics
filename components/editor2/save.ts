'use client'

import { useEffect, useRef } from 'react'
import { useStore, isHydrating } from './store'
import { saveDiagram } from '@/lib/actions/diagrams'
import { restoreDiagram } from './io'
import type { Diagram } from './types'

const DEBOUNCE_MS = 300

export const LOCAL_DRAFT_KEY = 'nesycat.editor.draft'

// Shared debounce/dedupe/hydration-skip/pagehide-flush machinery behind
// both the server-action autosave and the localStorage draft sink: subscribes
// to store diagram changes, debounces, dedupes by serialized JSON, skips the
// hydration swap (so cross-diagram navigation doesn't write the new diagram
// back to the old key), and flushes on unload. `sink` receives the
// already-computed JSON string, so callers never double-stringify.
function useDebouncedDiagramSink(key: string | null, sink: (json: string) => void) {
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
      sink(json)
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
  useDebouncedDiagramSink(diagramId, (json) => {
    saveDiagram(diagramId as string, JSON.parse(json)).catch((err) => {
      console.error('saveDiagram failed', err)
    })
  })
}

// Anonymous local draft: same debounce/dedupe/flush behavior, writing to
// localStorage instead of the DB. try/catch-swallowed (matches Canvas.tsx's
// existing localStorage idiom) so a disabled/full localStorage never breaks
// the editor.
export function useLocalAutosave(enabled: boolean) {
  useDebouncedDiagramSink(enabled ? LOCAL_DRAFT_KEY : null, (json) => {
    try {
      localStorage.setItem(LOCAL_DRAFT_KEY, json)
    } catch {
      // localStorage disabled/full — editor keeps working in-memory.
    }
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
