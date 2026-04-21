'use client'

import { useEffect, useRef } from 'react'
import { useStore } from './store'
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
