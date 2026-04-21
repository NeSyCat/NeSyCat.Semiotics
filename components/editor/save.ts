'use client'

import { useEffect, useRef } from 'react'
import { useStore } from './store'
import { saveDiagram } from '@/lib/actions/diagrams'

const DEBOUNCE_MS = 500

export function useAutosave(diagramId: string | null) {
  const firstRef = useRef(true)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!diagramId) return
    return useStore.subscribe((state, prev) => {
      if (state.diagram === prev.diagram) return
      if (firstRef.current) { firstRef.current = false; return }
      if (timerRef.current) clearTimeout(timerRef.current)
      const snapshot = state.diagram
      timerRef.current = setTimeout(() => {
        saveDiagram(diagramId, snapshot).catch((err) => {
          console.error('saveDiagram failed', err)
        })
      }, DEBOUNCE_MS)
    })
  }, [diagramId])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])
}
