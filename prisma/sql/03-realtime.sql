-- ============================================================================
--  OUT-OF-CONTRACT SQL LANE — invisible to the Prisma contract (prisma/contract.prisma).
--  Applied by CI after `prisma db init` / `prisma db update`. See
--  prisma/README.md for the full pipeline.
--
--  Adds public.diagrams to the `supabase_realtime` publication so
--  postgres_changes (Supabase Realtime) can stream INSERT/UPDATE/DELETE on
--  it to subscribed browser clients — this is what powers the live sidebar
--  diagram list and live content sync for an open diagram
--  (lib/realtime/use-diagrams-channel.ts,
--  lib/realtime/use-diagram-content-channel.ts). No table is a Realtime
--  source until it is explicitly added to this publication; a fresh preview
--  branch DB built from the contract has diagrams (and every other table)
--  OUT of it by default.
--
--  Authorization comes free: postgres_changes replays each change through
--  the SUBSCRIBING client's own RLS, and diagrams_member_all
--  (prisma/contract.prisma) already scopes all access to
--  my_member_organizations() — nobody receives an event for a diagram in an
--  organization they are not a member of, with no separate Realtime-side
--  authorization step to configure.
--
--  DELETE events under the table's default (and here, unchanged) replica
--  identity carry only the primary key (id) in `old` — no title, data, or
--  organization_id. That is sufficient for this use case: the sidebar only
--  needs the id to remove a row from the list. Do NOT set
--  `REPLICA IDENTITY FULL` on public.diagrams to chase a richer DELETE
--  payload — it doubles WAL volume for this table's `data` jsonb column
--  (potentially large diagram documents) for no feature this app needs.
--
--  Idempotent: guarded by a pg_publication_tables membership check, so
--  re-running this file (a subsequent `db update`, or a re-applied preview
--  branch) is a no-op once the table is already a publication member. Also
--  guarded by a pg_publication existence check so this is inert (not an
--  error) against a plain Postgres instance that has no `supabase_realtime`
--  publication at all (e.g. a non-Supabase local/CI database).
-- ============================================================================

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'diagrams'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.diagrams;
  END IF;
END $$;
