'use client'

import { useEffect, useRef, type MutableRefObject } from 'react'
import { useStore, isHydrating } from '../state/store'
import { saveDiagram } from '@/lib/actions/diagrams'
import { restoreDiagram } from './io'
import { encodeJsonToFragment } from './share'
import { useDiagramContentChannel } from '@/lib/realtime/use-diagram-content-channel'
import type { DiagramChangeRow } from '@/lib/realtime/use-diagrams-channel'
import type { Diagram } from '../domain/types'

const DEBOUNCE_MS = 300

export const LOCAL_DRAFT_KEY = 'nesycat.editor.draft'

// Shared debounce/dedupe/hydration-skip/pagehide-flush machinery behind
// both the server-action autosave and the localStorage draft sink: subscribes
// to store diagram changes, debounces, dedupes by serialized JSON, skips the
// hydration swap (so cross-diagram navigation doesn't write the new diagram
// back to the old key), and flushes on unload. `sink` receives the
// already-computed JSON string (so callers never double-stringify) plus the
// snapshot it was computed from.
// `externalLastSavedJsonRef`, when passed, is used in place of the ref this
// hook would otherwise create internally, so a caller (useAutosave, for the
// write-loop guard below) can both read it (skip re-saving an incoming
// remote echo) and write it (mark a remote snapshot as already-saved so the
// next debounced flush dedupes it away instead of echoing it back to the DB).
function useDebouncedDiagramSink(
  key: string | null,
  sink: (json: string, snapshot: Diagram) => void,
  externalLastSavedJsonRef?: MutableRefObject<string | null>,
) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingRef = useRef<Diagram | null>(null)
  const ownLastSavedJsonRef = useRef<string | null>(null)
  const lastSavedJsonRef = externalLastSavedJsonRef ?? ownLastSavedJsonRef

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
// action, plus live content sync for this diagram: an UPDATE from another
// client (another tab, another member, or the MCP server — which writes
// diagrams directly and today is invisible to an already-open editor)
// hydrates the store in place instead of leaving the canvas stale.
//
// Write-loop guard: applyRemoteDiagramUpdate below shares `lastSavedJsonRef`
// with the debounced sink above. When a remote row is applied, it stamps
// `lastSavedJsonRef.current` with the incoming JSON *before* touching the
// store. Setting `diagram` still runs through the same zustand subscription
// the sink uses (state.diagram !== prev.diagram), which schedules a normal
// debounced flush — but when that flush's `JSON.stringify(snapshot)` is
// compared against `lastSavedJsonRef.current`, they're now equal (both are
// the just-applied remote JSON), so the existing dedupe skips the write.
// The remote echo never round-trips back to the DB as a duplicate save, and
// no new machinery was needed for it — the guard rides the sink's existing
// "skip a write when it matches what we last saved" rule.
export function useAutosave(diagramId: string | null) {
  const lastSavedJsonRef = useRef<string | null>(null)

  useDebouncedDiagramSink(
    diagramId,
    (_json, snapshot) => {
      saveDiagram(diagramId as string, snapshot).catch((err) => {
        console.error('saveDiagram failed', err)
      })
    },
    lastSavedJsonRef,
  )

  useDiagramContentChannel(diagramId, (row) => {
    applyRemoteDiagramUpdate(diagramId, row, lastSavedJsonRef)
  })
}

// Applies an incoming realtime UPDATE row to the store, iff it is a genuine
// change from ANOTHER client — i.e. it differs both from what's currently
// on screen (nothing to do) and from the last JSON this tab itself saved
// (that's just this save's own echo arriving back over the wire).
//
// Hydrates via a direct `useStore.setState({ diagram })` rather than
// `initStore` or any of the mutation helpers in state/store.ts: none of the
// store's undoable mutators (`setCur`) run, so `history`/`historyIndex` are
// left untouched — no undo entry is created for a remote change, matching
// the ticket's requirement, without the larger reset (history, selection,
// coalesce tag) `initStore` performs for a fresh document load. Trade-off:
// `history[historyIndex]` no longer matches `diagram` after this call, so an
// immediate Undo jumps back to this tab's last local edit rather than "one
// step before the remote change" — acceptable since the alternative
// (initStore's full reset) would discard this tab's own undo stack instead.
function applyRemoteDiagramUpdate(
  diagramId: string | null,
  row: DiagramChangeRow,
  lastSavedJsonRef: MutableRefObject<string | null>,
) {
  if (!diagramId || row.id !== diagramId) return
  if (isHydrating()) return // a fresh initStore (e.g. cross-diagram nav) is in flight

  let incoming: Diagram
  try {
    // Realtime jsonb normally arrives decoded, but log the shape so a
    // string/mangled payload (which restoreDiagram would silently normalize
    // to an empty diagram) is visible instead of masquerading as a skip.
    console.debug('applyRemoteDiagramUpdate: incoming data type', typeof row.data,
      typeof row.data === 'string' ? (row.data as string).slice(0, 80) : JSON.stringify(row.data)?.slice(0, 80))
    incoming = restoreDiagram(typeof row.data === 'string' ? JSON.parse(row.data) : row.data)
  } catch (err) {
    console.error('applyRemoteDiagramUpdate: restoreDiagram failed', err)
    return
  }

  const incomingJson = JSON.stringify(incoming)
  if (incomingJson === JSON.stringify(useStore.getState().diagram)) {
    console.debug('applyRemoteDiagramUpdate: identical to current state, skipped')
    return
  }
  if (incomingJson === lastSavedJsonRef.current) {
    console.debug('applyRemoteDiagramUpdate: own-save echo, skipped')
    return
  }

  lastSavedJsonRef.current = incomingJson
  useStore.setState({ diagram: incoming })
  console.debug('applyRemoteDiagramUpdate: remote snapshot applied')
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
    try {
      history.replaceState(null, '', location.pathname + location.search)
    } catch {
      // Safari rate-limits replaceState (SecurityError) — skip this write;
      // the next debounced edit retries and the draft is unaffected.
    }
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
