-- ============================================================================
--  HAND-EDITED. `drizzle-kit generate` produced every DDL statement below
--  from schema.ts (the four DROP POLICY lines, the ADD COLUMN, the two ADD
--  CONSTRAINT lines, the DROP COLUMN, and the CREATE POLICY) — none of that
--  SQL text was written by hand. What changed by hand is the *order* of
--  those statements, plus a data backfill inserted between them: moving
--  diagrams from user-ownership (owned_by) to org-ownership
--  (organization_id) is a data migration drizzle-kit can't express — every
--  existing diagrams row must resolve to a real organization_id before that
--  column can go NOT NULL, and a user who owns diagrams but has no
--  organization yet needs one bootstrapped first. Safe order (design doc
--  .foreman/scratch/design-org-model-v2.md §3):
--    1. drop the 4 diagrams_*_own policies         — they reference owned_by
--    2. add organization_id NULLABLE, no constraint — nothing to backfill
--       into otherwise
--    3. backfill (hand-written): bootstrap a `{name}'s Organization` + owner
--       membership for every user who owns a diagram but has no membership
--       row yet, then set diagrams.organization_id from that user's (now
--       guaranteed) owner membership
--    3b. delete diagrams whose owner's login no longer exists (unreachable
--        under old and new RLS alike — erasure doctrine; production holds
--        such rows, so this is a live path, not defensive fiction)
--    4. set organization_id NOT NULL
--    5. add the two FK constraints (diagrams.organization_id and
--       memberships.organization_id → organizations.id)
--    6. drop owned_by                               — its last read was the
--       backfill's UPDATE, one statement above
--    7. create diagrams_member_all
--  meta/ and the journal are untouched — drizzle wrote them from schema.ts's
--  end state, which this migration still reaches unchanged; only the .sql
--  body's statement order and content were hand-edited. See SCHEMA.md for
--  the tables/policies doctrine this migration moves the database to.
-- ============================================================================

DROP POLICY "diagrams_select_own" ON "diagrams" CASCADE;--> statement-breakpoint
DROP POLICY "diagrams_insert_own" ON "diagrams" CASCADE;--> statement-breakpoint
DROP POLICY "diagrams_update_own" ON "diagrams" CASCADE;--> statement-breakpoint
DROP POLICY "diagrams_delete_own" ON "diagrams" CASCADE;--> statement-breakpoint
ALTER TABLE "diagrams" ADD COLUMN "organization_id" uuid;--> statement-breakpoint
WITH missing AS (
  -- Only owners whose login still exists: a diagram whose auth.users row was
  -- deleted can't get an organization (ins_org joins auth.users for the org
  -- name), and inserting a membership for an org row that was never created
  -- would break the memberships FK added below. Such diagrams are removed
  -- outright before SET NOT NULL — see the DELETE two statements down.
  SELECT s.user_id, gen_random_uuid() AS org_id
  FROM (SELECT DISTINCT d.owned_by AS user_id FROM public.diagrams d
        WHERE EXISTS (SELECT 1 FROM auth.users u WHERE u.id = d.owned_by)
          AND NOT EXISTS (SELECT 1 FROM public.memberships m
                          WHERE m.user_id = d.owned_by)) s
), ins_org AS (
  INSERT INTO public.organizations (id, name)
  -- Outer coalesce: a live login with NULL email AND no name metadata would
  -- make the whole concat NULL and abort on organizations.name NOT NULL.
  -- Prod has no such row today (checked), but the migration must be total.
  SELECT mi.org_id,
         coalesce(coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                           nullif(trim(u.raw_user_meta_data->>'name'), ''),
                           split_part(u.email, '@', 1)) || '''s Organization',
                  'Organization')
  FROM missing mi JOIN auth.users u ON u.id = mi.user_id
  RETURNING id
)
INSERT INTO public.memberships (user_id, organization_id, is_owner)
SELECT mi.user_id, mi.org_id, true FROM missing mi;--> statement-breakpoint
UPDATE public.diagrams d SET organization_id =
  (SELECT m.organization_id FROM public.memberships m
   WHERE m.user_id = d.owned_by AND m.is_owner
   ORDER BY m.created_at LIMIT 1)
WHERE d.organization_id IS NULL;--> statement-breakpoint
-- Diagrams still without an organization here are owned by DELETED logins
-- (production had exactly this: rows whose owned_by no longer exists in
-- auth.users). They were unreachable under the old owner-only RLS and can
-- never gain a membership path under the new model; keeping them would block
-- SET NOT NULL. Removing them follows the erasure doctrine (SCHEMA.md
-- Preamble): when a login goes, its unreachable data goes.
DELETE FROM public.diagrams WHERE organization_id IS NULL;--> statement-breakpoint
ALTER TABLE "diagrams" ALTER COLUMN "organization_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "diagrams" ADD CONSTRAINT "diagrams_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "diagrams" DROP COLUMN "owned_by";--> statement-breakpoint
CREATE POLICY "diagrams_member_all" ON "diagrams" AS PERMISSIVE FOR ALL TO "authenticated" USING ("diagrams"."organization_id" in (select public.my_member_organizations())) WITH CHECK ("diagrams"."organization_id" in (select public.my_member_organizations()));
