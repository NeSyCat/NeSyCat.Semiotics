-- ============================================================================
--  00-preflight.sql — one-time STRUCTURAL changes the contract planner cannot
--  derive. Prisma 8's `db update` refuses to plan primary-key changes
--  (MIGRATION.PLANNING_FAILED / indexIncompatible) and points at hand-authored
--  migrations — which the adopted graph doesn't support in this RC. So
--  structural one-timers live here: existence-guarded and idempotent, applied
--  by CI BEFORE `db init`/`db update` in every environment.
--    - fresh DB (preview bootstrap): table doesn't exist yet → no-op; db init
--      builds the final shape straight from the contract.
--    - un-migrated DB (production, older branch DBs): performs the change once.
--    - already-migrated DB: guard finds nothing to do → no-op.
-- ============================================================================

-- memberships: drop the surrogate `id` in favor of the natural composite
-- primary key (user_id, organization_id) — matches the contract's
-- @@id([user_id, organization_id]) and Admination's own membership design.
-- The separate user/org unique constraint dies with it (the PK subsumes it).
DO $$
BEGIN
  IF to_regclass('public.memberships') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public'
                   AND table_name = 'memberships'
                   AND column_name = 'id') THEN
    ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_user_org_unique;
    ALTER TABLE public.memberships DROP CONSTRAINT IF EXISTS memberships_pkey;
    ALTER TABLE public.memberships DROP COLUMN id;
    ALTER TABLE public.memberships ADD CONSTRAINT memberships_pkey PRIMARY KEY (user_id, organization_id);
  END IF;
END $$;
