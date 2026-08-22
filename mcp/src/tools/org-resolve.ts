import type { SupabaseClient } from '@supabase/supabase-js'
import { defaultOrgEnv } from '../supabase/client.js'

// Every diagrams row is scoped to exactly one organization (see
// prisma/contract.prisma's `diagrams.organization_id`), and this server
// never accepts one blindly: create_diagram/import_diagram fall back to
// SEMIOTICS_DEFAULT_ORG, then (if unset) to "the user's only organization"
// when that's unambiguous — otherwise the caller (an LLM, here) must call
// list_organizations and pass one explicitly. RLS on `organizations` means
// every query below only ever sees organizations the signed-in user is a
// member of, so there is no cross-tenant leak in the "list them" branch.
export async function resolveOrganizationId(
  client: SupabaseClient,
  organizationId: string | undefined,
): Promise<{ organizationId: string } | { error: string }> {
  if (organizationId) {
    const { data, error } = await client.from('organizations').select('id').eq('id', organizationId).maybeSingle()
    if (error) return { error: error.message }
    if (!data) return { error: `No organization found with id ${organizationId} (or you are not a member of it)` }
    return { organizationId: data.id as string }
  }

  const fallback = defaultOrgEnv()
  if (fallback) return { organizationId: fallback }

  const { data, error } = await client.from('organizations').select('id, name')
  if (error) return { error: error.message }
  const orgs = (data ?? []) as Array<{ id: string; name: string }>
  if (orgs.length === 1) return { organizationId: orgs[0].id }
  if (orgs.length === 0) {
    return { error: 'You are not a member of any organization yet.' }
  }
  return {
    error:
      'organizationId is required — you belong to multiple organizations. Call list_organizations, then pass one explicitly. Available: ' +
      orgs.map((o) => `${o.name} (${o.id})`).join(', '),
  }
}
