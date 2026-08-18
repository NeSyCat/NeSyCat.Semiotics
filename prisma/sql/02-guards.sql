-- ============================================================================
--  OUT-OF-CONTRACT SQL LANE — invisible to the Prisma contract (prisma/contract.prisma).
--  Applied by CI after `prisma db init` / `prisma db update`. See
--  prisma/README.md for the full pipeline.
--
--  prevent_orphan_organization() — a BEFORE UPDATE OR DELETE trigger on
--  public.memberships. RLS (memberships_update_owner / _delete_owner in the
--  contract) already restricts who can touch a membership row, but nothing
--  stops an owner from demoting/removing themselves (or the app from doing
--  it via a bug) and leaving the organization with zero is_owner rows —
--  after which my_owner_organizations() matches it for nobody, and no policy
--  anywhere grants owner-level access back. This is the authoritative guard
--  against that; app-side UI checks are courtesy only. NOT SECURITY DEFINER,
--  so the trigger's internal queries run as the INVOKING role and are subject
--  to RLS — correct today because only org owners can reach UPDATE/DELETE on
--  owner rows, and owners pass every policy these queries need
--  (memberships_select_member; organizations row lock via
--  my_owner_organizations). If a future policy narrows what owners can
--  SELECT here, make this SECURITY DEFINER at the same time.
--
--  NOTE: the memberships (user_id, organization_id) UNIQUE constraint that
--  originally shipped alongside this trigger (supabase/migrations-archive/
--  0003_org_membership_guards.sql) is NOT repeated here — it is a contract
--  concept now (`@@unique([userId, organizationId])` on Memberships in
--  prisma/contract.prisma) and is created by `prisma db init`/`db update`.
--
--  Ported verbatim from
--  supabase/migrations-archive/0003_org_membership_guards.sql, converted to
--  a standalone idempotent file: CREATE OR REPLACE for the function (already
--  idempotent) plus DROP TRIGGER IF EXISTS before CREATE TRIGGER (triggers
--  have no CREATE OR REPLACE), so this file is safe to (re)run against a DB
--  that already has it (prod) or one that doesn't yet (fresh preview branch).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.prevent_orphan_organization() RETURNS trigger
  LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE
  remaining_owners integer;
BEGIN
  -- A non-owner row's UPDATE/DELETE can never change the org's owner count —
  -- skip it, so an unrelated edit never gets a false-positive block.
  IF NOT OLD.is_owner THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- Lock the org row first so two concurrent "remove the last owner"
  -- statements under READ COMMITTED can't both see ">0 other owners" and
  -- both succeed.
  PERFORM 1 FROM public.organizations WHERE id = OLD.organization_id FOR UPDATE;

  -- Org row already gone (org-deletion flow deletes it first — there is no FK
  -- cascade): nothing left to orphan, so let its membership rows be cleaned up.
  IF NOT FOUND THEN
    RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  -- "Other rows" = different user in the same org: since the primary key is
  -- (user_id, organization_id), user_id alone distinguishes rows within one
  -- organization. (Rewritten from `id <> OLD.id` when the surrogate id column
  -- was dropped in favor of the composite PK.)
  SELECT count(*) INTO remaining_owners
  FROM public.memberships
  WHERE organization_id = OLD.organization_id AND user_id <> OLD.user_id AND is_owner;

  -- An UPDATE that keeps this row an owner of the SAME org adds it back in.
  -- A DELETE, an UPDATE that clears is_owner, or an UPDATE that reassigns the
  -- row to a different org all leave OLD's org with one fewer owner.
  IF TG_OP = 'UPDATE' AND NEW.is_owner AND NEW.organization_id = OLD.organization_id THEN
    remaining_owners := remaining_owners + 1;
  END IF;

  IF remaining_owners = 0 THEN
    RAISE EXCEPTION 'cannot remove the last owner of organization %', OLD.organization_id
      USING HINT = 'Assign another owner before removing or demoting this one.';
  END IF;

  RETURN CASE TG_OP WHEN 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS memberships_prevent_orphan_organization ON public.memberships;
CREATE TRIGGER memberships_prevent_orphan_organization
  BEFORE UPDATE OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.prevent_orphan_organization();
