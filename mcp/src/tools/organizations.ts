import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { text, errorText } from './result.js'

export function registerOrganizationTools(server: McpServer, getClient: () => SupabaseClient) {
  server.registerTool(
    'list_organizations',
    {
      title: 'List organizations',
      description:
        'Organizations the signed-in user belongs to (RLS-scoped — this can never see an organization the user is not a member of).',
    },
    async () => {
      const { data, error } = await getClient().from('organizations').select('id, name').order('name')
      if (error) return errorText(error.message)
      return text(data)
    },
  )
}
