'use client'

import { useEffect, useRef } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/client'
import { supabaseConfigured } from '@/lib/supabase/env'
import { ensureRealtimeAuth } from './ensure-auth'

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
// Requires prisma/sql/03-realtime.sql to be applied — until
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
    let client: ReturnType<typeof createClient> | null = null
    let cancelled = false
    ;(async () => {
    try {
      const supabase = createClient()
      client = supabase
      // MUST run before subscribe — the socket is otherwise anonymous and
      // RLS drops every event. See lib/realtime/ensure-auth.ts.
      await ensureRealtimeAuth(supabase)
      if (cancelled) return // unmounted/org changed while awaiting
      channel = supabase
        .channel(`diagrams-org-${organizationId}`)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'diagrams',
            filter: `organization_id=eq.${organizationId}`,
          },
          (payload) => {
            try {
              callbacksRef.current.onInsert?.(payload.new as DiagramChangeRow)
            } catch (err) {
              console.error('useDiagramsChannel: onInsert failed', err)
            }
          },
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'diagrams',
            filter: `organization_id=eq.${organizationId}`,
          },
          (payload) => {
            try {
              callbacksRef.current.onUpdate?.(payload.new as DiagramChangeRow)
            } catch (err) {
              console.error('useDiagramsChannel: onUpdate failed', err)
            }
          },
        )
        // DELETE deliberately has NO organization filter — it structurally
        // CANNOT have one: under the table's default replica identity a
        // DELETE's `old` record carries ONLY the primary key, so a filter on
        // organization_id never matches and the server silently drops every
        // delete (found empirically: renames arrived, deletes never did).
        // Listening unfiltered and matching ids client-side is the standard
        // workaround; all that reaches a non-member from a foreign delete is
        // an opaque row uuid (RLS cannot evaluate DELETEs either way), and
        // the sidebar ignores ids it doesn't have.
        .on(
          'postgres_changes',
          { event: 'DELETE', schema: 'public', table: 'diagrams' },
          (payload) => {
            try {
              const old = payload.old as Partial<DiagramChangeRow>
              if (old.id) callbacksRef.current.onDelete?.(old.id)
            } catch (err) {
              console.error('useDiagramsChannel: onDelete failed', err)
            }
          },
        )
        // Status callback so a failing subscription is VISIBLE: without it a
        // channel that errors or times out just silently never delivers —
        // the exact failure mode that hid the socket-auth bug.
        .subscribe((status, err) => {
          if (status === 'SUBSCRIBED') console.debug('useDiagramsChannel: subscribed')
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') console.error('useDiagramsChannel: channel ' + status, err)
        })
    } catch (err) {
      console.error('useDiagramsChannel: subscribe failed', err)
      channel = null
    }
    })()

    return () => {
      cancelled = true
      if (!channel) return
      try {
        // removeChannel (not bare unsubscribe): createBrowserClient is a
        // singleton, so an unsubscribed-but-not-removed channel object would
        // accumulate on it across every org/diagram switch — a slow leak in
        // long sessions.
        if (client) client.removeChannel(channel)
        else channel.unsubscribe()
      } catch (err) {
        console.error('useDiagramsChannel: channel cleanup failed', err)
      }
    }
  }, [organizationId])
}
