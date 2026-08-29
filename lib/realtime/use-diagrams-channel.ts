'use client'

import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { supabaseConfigured } from '@/lib/supabase/env'

// The shape postgres_changes hands back for a public.diagrams row. Matches
// the contract (prisma/contract.prisma `model diagrams`) field-for-field;
// `data` is left untyped here since callers that need it run it through
// restoreDiagram (components/editor/persist/io.ts) for normalization.
export interface DiagramChangeRow {
  id: string
  title: string
  data: unknown
  created_at: string
  updated_at: string
  organization_id: string
}

export interface DiagramsChannelCallbacks {
  onInsert?: (row: DiagramChangeRow) => void
  onUpdate?: (row: DiagramChangeRow) => void
  onDelete?: (id: string) => void
}

// Live sidebar sync: subscribes to postgres_changes on public.diagrams for
// one organization so INSERT/UPDATE/DELETE from ANY client (another tab,
// another member, the MCP server) reach every open sidebar. Authorization is
// free — postgres_changes replays through the subscriber's own RLS, and
// diagrams_member_all (prisma/contract.prisma) already scopes rows to the
// caller's organizations; the `organization_id=eq.<org>` filter here is a
// bandwidth/relevance narrowing on top of that, not a security boundary.
//
// No-ops (never constructs a Supabase client, never subscribes) when:
//   - organizationId is null (nothing to scope to — e.g. no active org yet)
//   - Supabase env is absent (lib/supabase/env.ts) — anonymous/env-less mode
//     (AnonymousEditor, CI, a fresh checkout with no .env.local) has no
//     session and createBrowserClient() would throw on the `!` env asserts.
// Never throws into React: subscribe/unsubscribe failures are caught and
// logged, and the effect always returns a (possibly no-op) cleanup.
//
// Requires prisma/sql/03-realtime-publication.sql to be applied — until
// then postgres_changes emits nothing and this hook is a silent no-op at
// the Postgres level (the .subscribe() call itself still succeeds).
export function useDiagramsChannel(organizationId: string | null, callbacks: DiagramsChannelCallbacks) {
  // Ref so a re-render with new callback identities doesn't tear down and
  // resubscribe the channel — only organizationId changing should do that.
  const callbacksRef = useRef(callbacks)
  callbacksRef.current = callbacks

  useEffect(() => {
    if (!organizationId || !supabaseConfigured()) return

    let channel: RealtimeChannel | null = null
    try {
      const supabase = createClient()
      channel = supabase
        .channel(`diagrams-org-${organizationId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'diagrams',
            filter: `organization_id=eq.${organizationId}`,
          },
          (payload) => {
            try {
              if (payload.eventType === 'INSERT') {
                callbacksRef.current.onInsert?.(payload.new as DiagramChangeRow)
              } else if (payload.eventType === 'UPDATE') {
                callbacksRef.current.onUpdate?.(payload.new as DiagramChangeRow)
              } else if (payload.eventType === 'DELETE') {
                // Default replica identity: DELETE's `old` carries only the
                // primary key (id) — sufficient for list removal, nothing
                // else is readable off it.
                const old = payload.old as Partial<DiagramChangeRow>
                if (old.id) callbacksRef.current.onDelete?.(old.id)
              }
            } catch (err) {
              console.error('useDiagramsChannel: callback failed', err)
            }
          },
        )
        .subscribe()
    } catch (err) {
      console.error('useDiagramsChannel: subscribe failed', err)
      channel = null
    }

    return () => {
      if (!channel) return
      try {
        channel.unsubscribe()
      } catch (err) {
        console.error('useDiagramsChannel: unsubscribe failed', err)
      }
    }
  }, [organizationId])
}
