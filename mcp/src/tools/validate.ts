import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { text } from './result.js'
import { validateDiagram } from '../diagram/ops.js'

export function registerValidateTools(server: McpServer) {
  server.registerTool(
    'validate_diagram',
    {
      title: 'Validate diagram',
      description:
        'Normalize+validate a diagram document (restoreDiagram) and report any dangling references it still has (a point naming a form that doesn\'t exist, a line or form edge naming a point that doesn\'t exist). Does not write anything.',
      inputSchema: { data: z.unknown() },
    },
    async ({ data }) => {
      const result = validateDiagram(data)
      return text({ ok: result.ok, problems: result.problems })
    },
  )
}
