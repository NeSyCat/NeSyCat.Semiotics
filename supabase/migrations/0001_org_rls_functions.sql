-- ============================================================================
--  RLS helper functions (SECURITY DEFINER) — organization membership.
-- ----------------------------------------------------------------------------
--  Drizzle has no declarative DSL for functions, so these are the one piece of
--  hand-written SQL. The pgPolicy() definitions in schema.ts (migration 0002)
--  reference them by name. LANGUAGE plpgsql bodies are not validated at CREATE
--  time, so it's safe for them to reference public.memberships / public.organizations
--  before either table exists — both are created in 0002, which runs right
--  after this migration. SECURITY DEFINER lets them read public.memberships
--  while RLS is enabled for the `authenticated` role; migrations themselves
--  connect as the table owner and bypass RLS, so this never blocks deploys —
--  it only governs the role used by supabase-js at runtime.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.my_member_organizations() RETURNS SETOF uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT organization_id FROM public.memberships WHERE user_id = auth.uid();
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.my_owner_organizations() RETURNS SETOF uuid
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN QUERY SELECT organization_id FROM public.memberships WHERE user_id = auth.uid() AND is_owner;
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.organization_has_no_members(org uuid) RETURNS boolean
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RETURN NOT EXISTS (SELECT 1 FROM public.memberships WHERE organization_id = org);
END;
$$;
