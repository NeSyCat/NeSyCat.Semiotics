'use client'

import { useEffect, useState, type ReactNode } from 'react'
import CanvasRoot from './ui/Canvas'
import { decodeDiagramFromFragment } from './persist/share'
import { loadLocalDraft } from './persist/save'
import type { Diagram } from './domain/types'

const emptyDiagram: Diagram = { schemaVersion: 1, forms: [], points: {}, lines: [] }

interface Props {
  topRight?: ReactNode
}

// Anonymous-first editor surface: no diagram id, no DB — the diagram lives in
// a URL fragment (shared link) or localStorage (draft), falling all the way
// back to a blank canvas. Load precedence: hash > draft > empty. Viewing a
// shared link never overwrites the draft — initStore sets the hydration
// flag, so only the first *edit* after load adopts it (useLocalAutosave
// skips hydration swaps, same as useAutosave).
export default function AnonymousEditor({ topRight }: Props) {
  const [initial, setInitial] = useState<Diagram | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const fromHash = await decodeDiagramFromFragment(location.hash)
      if (cancelled) return
      setInitial(fromHash ?? loadLocalDraft() ?? emptyDiagram)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!initial) return null
  return <CanvasRoot diagramId={null} initialData={initial} localDraft topRight={topRight} />
}
