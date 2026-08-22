import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { text } from './result.js'

export function registerWhoamiTools(server: McpServer, getClient: () => SupabaseClient) {
  server.registerTool(
    'whoami',
    {
      title: 'Whoami',
      description:
        'The currently signed-in user (email, id) — or a "not logged in" result if `npm run login` has not been run yet (see mcp/README.md).',
    },
    async () => {
      const { data, error } = await getClient().auth.getUser()
      if (error || !data.user) {
        return text({ loggedIn: false, message: 'Not logged in — run `npm run login` in mcp/.' })
      }
      return text({ loggedIn: true, id: data.user.id, email: data.user.email ?? null })
    },
  )
}
