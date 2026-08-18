-- ============================================================================
--  Membership guards — two things the codegen (v1) can't express declaratively:
--
--  1. A user can only belong to an organization once. Composite UNIQUE
--     constraints aren't representable in the diagram/codegen yet, so it's
--     hand-added here.
--
--  2. prevent_orphan_organization() — a BEFORE UPDATE OR DELETE trigger on
--     public.memberships. RLS (memberships_update_owner / _delete_owner,
--     migration 0002) already restricts who can touch a membership row, but
--     nothing stops an owner from demoting/removing themselves (or the app
--     from doing it via a bug) and leaving the organization with zero
--     is_owner rows — after which my_owner_organizations() matches it for
--     nobody, and no policy anywhere grants owner-level access back. This is
--     the authoritative guard against that; app-side UI checks are courtesy
--     only. NOT SECURITY DEFINER, so the trigger's internal queries run as
--     the INVOKING role and are subject to RLS — correct today because only
--     org owners can reach UPDATE/DELETE on owner rows, and owners pass every
--     policy these queries need (memberships_select_member; organizations
--     row lock via my_owner_organizations). If a future policy narrows what
--     owners can SELECT here, make this SECURITY DEFINER at the same time.
-- ============================================================================

ALTER TABLE public.memberships ADD CONSTRAINT memberships_user_org_unique UNIQUE (user_id, organization_id);
--> statement-breakpoint
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

  SELECT count(*) INTO remaining_owners
  FROM public.memberships
  WHERE organization_id = OLD.organization_id AND id <> OLD.id AND is_owner;

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
--> statement-breakpoint
CREATE TRIGGER memberships_prevent_orphan_organization
  BEFORE UPDATE OR DELETE ON public.memberships
  FOR EACH ROW EXECUTE FUNCTION public.prevent_orphan_organization();
