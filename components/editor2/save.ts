'use client'

import { useEffect, useRef } from 'react'
import { useStore, isHydrating } from './store'
import { saveDiagram } from '@/lib/actions/diagrams'
import type { Diagram } from './types'

const DEBOUNCE_MS = 300

// Autosave: subscribes to store diagram changes, debounces, dedupes by
// serialized JSON, skips the hydration swap (so cross-diagram navigation
// doesn't write the new diagram back to the old id), and flushes on unload.
export function useAutosave(diagramId: string | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Diagram | null>(null)
  const lastSavedJsonRef = useRef<string | null>(null)

  useEffect(() => {
    if (!diagramId) return

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
      saveDiagram(diagramId, snapshot).catch((err) => {
        console.error('saveDiagram failed', err)
      })
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
  }, [diagramId])
}
