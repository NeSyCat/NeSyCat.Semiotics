'use client'

import { useEffect, useRef } from 'react'
import { useStore, isHydrating } from './store'
import { saveDiagram } from '@/lib/actions/diagrams'
import type { DiagramData } from './types'

const DEBOUNCE_MS = 300

export function useAutosave(diagramId: string | null) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<DiagramData | null>(null)

  useEffect(() => {
    if (!diagramId) return

    const flush = () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current)
        timerRef.current = null
      }
      const snapshot = pendingRef.current
      if (!snapshot) return
      pendingRef.current = null
      saveDiagram(diagramId, snapshot).catch((err) => {
        console.error('saveDiagram failed', err)
      })
    }

    const unsub = useStore.subscribe((state, prev) => {
      if (state.diagram === prev.diagram) return
      // Skip the swap when initStore loads a new diagram's data into the store.
      // Otherwise the autosave would treat the load as an edit and write the
      // NEW diagram's content back to the OLD diagramId from this effect's
      // closure — wiping the source diagram on every navigation.
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
