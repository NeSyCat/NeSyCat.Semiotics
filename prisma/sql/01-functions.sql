-- ============================================================================
--  OUT-OF-CONTRACT SQL LANE — invisible to the Prisma contract (prisma/contract.prisma).
--  Applied by CI before `prisma db init` (fresh DB) / `prisma db update`
--  (existing DB). See prisma/README.md for the full pipeline.
--
--  RLS helper functions (SECURITY DEFINER) — organization membership. The PSL
--  contract has no declarative construct for functions, so these are
--  hand-written SQL; the 11 policies in prisma/contract.prisma reference them
--  by name. `db init` on an EMPTY database FAILS without this file applied
--  first — the policies it creates reference these functions. CREATE OR
--  REPLACE makes this file idempotent: safe to run against a DB that already
--  has them (prod) or one that doesn't yet (fresh preview branch).
--
--  Ported verbatim (same LANGUAGE/STABLE/SECURITY DEFINER/search_path) from
--  supabase/migrations-archive/0001_org_rls_functions.sql, converted to a
--  standalone idempotent file (no --> statement-breakpoint markers — those
--  are Drizzle migration-splitter syntax, not valid SQL on their own).
-- ============================================================================

CREATE OR REPLACE FUNCTION public.my_member_organizations() RETURNS SETOF uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT organization_id FROM public.memberships WHERE user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.my_owner_organizations() RETURNS SETOF uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT organization_id FROM public.memberships WHERE user_id = auth.uid() AND is_owner;
END;
$$;

CREATE OR REPLACE FUNCTION public.organization_has_no_members(org uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN NOT EXISTS (SELECT 1 FROM public.memberships WHERE organization_id = org);
END;
$$;

-- Remove the first-draft two-argument form. It took the caller's identity as
-- a PARAMETER, which a SECURITY DEFINER function must never do: anyone able
-- to reach the function (PostgREST exposes `public` functions as RPC, and
-- EXECUTE defaults to PUBLIC — including `anon`) could pass any member's uuid
-- and read that organization's whole roster, emails included. Caught by
-- adversarial review before it ever left the sandbox.
DROP FUNCTION IF EXISTS public.org_members_for(uuid, uuid);
-- org_members_for(org) — roster lookup for the OrgSettings panel. Needs
-- auth.users emails, which RLS-scoped app queries cannot join against, so it
-- runs SECURITY DEFINER — and therefore derives the caller ITSELF from
-- auth.uid() and gates on that caller's own membership. Called inside a
-- withRLS transaction (where request.jwt.claims is set), so auth.uid() is
-- the verified session user; called without claims it returns nothing.
CREATE OR REPLACE FUNCTION public.org_members_for(org uuid)
RETURNS TABLE(user_id uuid, email text, display_name text, is_owner boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  caller uuid := auth.uid();
BEGIN
  -- Gate INSIDE the definer: the CALLER must itself be a member of org.
  IF caller IS NULL OR NOT EXISTS (SELECT 1 FROM public.memberships m
                 WHERE m.user_id = caller AND m.organization_id = org) THEN
    RETURN;
  END IF;
  RETURN QUERY
    SELECT m.user_id,
           u.email::text,
           coalesce(nullif(trim(u.raw_user_meta_data->>'full_name'), ''),
                    nullif(trim(u.raw_user_meta_data->>'name'), ''),
                    split_part(u.email::text, '@', 1)) AS display_name,
           m.is_owner
    FROM public.memberships m
    LEFT JOIN auth.users u ON u.id = m.user_id
    WHERE m.organization_id = org
    ORDER BY display_name;
END; $$;
-- Defence in depth for every SECURITY DEFINER function here: EXECUTE defaults
-- to PUBLIC, and PostgREST publishes `public` functions as RPC endpoints, so
-- an unauthenticated caller holding only the publishable key could invoke
-- them. They are meant to be called by signed-in application code, so the
-- grant is narrowed to `authenticated`. (The definer bodies gate on auth.uid()
-- as well — this is the second lock, not the only one.)
REVOKE EXECUTE ON FUNCTION public.org_members_for(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_member_organizations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.my_owner_organizations() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.organization_has_no_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_members_for(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_member_organizations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.my_owner_organizations() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.organization_has_no_members(uuid) TO authenticated, service_role;
