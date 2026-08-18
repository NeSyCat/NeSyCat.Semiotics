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

-- org_members_for(requesting_user, org) — roster lookup for the OrgSettings
-- panel. Needs auth.users emails, which RLS-scoped app queries cannot join
-- against directly, so it runs SECURITY DEFINER with its OWN membership gate
-- inside (requesting_user must itself be a member of org) rather than relying
-- on caller-side RLS. Called client-level (row-returning raw SQL can't run
-- inside a withRLS tx); the caller passes the verified session user id.
CREATE OR REPLACE FUNCTION public.org_members_for(requesting_user uuid, org uuid)
RETURNS TABLE(user_id uuid, email text, display_name text, is_owner boolean)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Gate INSIDE the definer: requesting_user must itself be a member of org.
  IF NOT EXISTS (SELECT 1 FROM public.memberships m
                 WHERE m.user_id = requesting_user AND m.organization_id = org) THEN
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
