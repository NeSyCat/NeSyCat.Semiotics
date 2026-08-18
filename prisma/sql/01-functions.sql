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
