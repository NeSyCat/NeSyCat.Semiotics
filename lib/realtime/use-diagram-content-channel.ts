'use client'

import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { supabaseConfigured } from '@/lib/supabase/env'
import type { DiagramChangeRow } from './use-diagrams-channel'

// Live content sync for the ONE open diagram: subscribes to UPDATE on
// public.diagrams filtered to this row's id, so a write from another tab,
// another member, or the MCP server (which writes diagrams directly and
// today is invisible to an already-open editor) reaches the canvas without
// a manual refresh. Only UPDATE is wired — an open diagram doesn't care
// about INSERT, and a DELETE of the row it's currently viewing is out of
// scope for this ticket (sidebar DELETE handling covers list removal).
//
// No-ops under the same conditions as useDiagramsChannel (lib/realtime/
// use-diagrams-channel.ts): diagramId null, or Supabase env absent
// (anonymous/env-less mode). Never throws into React.
//
// Requires prisma/sql/03-realtime.sql to be applied.
export function useDiagramContentChannel(diagramId: string | null, onUpdate: (row: DiagramChangeRow) => void) {
  const onUpdateRef = useRef(onUpdate)
  onUpdateRef.current = onUpdate

  useEffect(() => {
    if (!diagramId || !supabaseConfigured()) return

    let channel: RealtimeChannel | null = null
    let client: ReturnType<typeof createClient> | null = null
    try {
      const supabase = createClient()
      client = supabase
      channel = supabase
        .channel(`diagram-content-${diagramId}`)
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'diagrams',
            filter: `id=eq.${diagramId}`,
          },
          (payload) => {
            try {
              onUpdateRef.current(payload.new as DiagramChangeRow)
            } catch (err) {
              console.error('useDiagramContentChannel: callback failed', err)
            }
          },
        )
        .subscribe()
    } catch (err) {
      console.error('useDiagramContentChannel: subscribe failed', err)
      channel = null
    }

    return () => {
      if (!channel) return
      try {
        // removeChannel (not bare unsubscribe): createBrowserClient is a
        // singleton, so an unsubscribed-but-not-removed channel object would
        // accumulate on it across every org/diagram switch — a slow leak in
        // long sessions.
        if (client) client.removeChannel(channel)
        else channel.unsubscribe()
      } catch (err) {
        console.error('useDiagramContentChannel: channel cleanup failed', err)
      }
    }
  }, [diagramId])
}
