CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"is_owner" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY "memberships_select_self" ON "memberships" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("memberships"."user_id" = (select auth.uid()));--> statement-breakpoint
CREATE POLICY "memberships_select_member" ON "memberships" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("memberships"."organization_id" in (select public.my_member_organizations()));--> statement-breakpoint
CREATE POLICY "memberships_insert_owner" ON "memberships" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("memberships"."organization_id" in (select public.my_owner_organizations()));--> statement-breakpoint
CREATE POLICY "memberships_insert_bootstrap" ON "memberships" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK ("memberships"."user_id" = (select auth.uid()) and "memberships"."is_owner" = true and public.organization_has_no_members("memberships"."organization_id"));--> statement-breakpoint
CREATE POLICY "memberships_update_owner" ON "memberships" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("memberships"."organization_id" in (select public.my_owner_organizations())) WITH CHECK ("memberships"."organization_id" in (select public.my_owner_organizations()));--> statement-breakpoint
CREATE POLICY "memberships_delete_owner" ON "memberships" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("memberships"."organization_id" in (select public.my_owner_organizations()));--> statement-breakpoint
CREATE POLICY "organizations_select_member" ON "organizations" AS PERMISSIVE FOR SELECT TO "authenticated" USING ("organizations"."id" in (select public.my_member_organizations()));--> statement-breakpoint
CREATE POLICY "organizations_insert_auth" ON "organizations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "organizations_update_owner" ON "organizations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING ("organizations"."id" in (select public.my_owner_organizations())) WITH CHECK ("organizations"."id" in (select public.my_owner_organizations()));--> statement-breakpoint
CREATE POLICY "organizations_delete_owner" ON "organizations" AS PERMISSIVE FOR DELETE TO "authenticated" USING ("organizations"."id" in (select public.my_owner_organizations()));