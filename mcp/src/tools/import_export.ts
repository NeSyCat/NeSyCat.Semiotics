import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { text, errorText } from './result.js'
import { resolveOrganizationId } from './org-resolve.js'
import { validateDiagram } from '../diagram/ops.js'
import { restoreDiagram } from '../vendor/editor/persist/io.js'
import { diagramToTikzCore } from '../vendor/editor/export/tikz.js'
import { diagramToHtmlCore } from '../vendor/editor/export/html.js'

export function registerImportExportTools(server: McpServer, getClient: () => SupabaseClient) {
  server.registerTool(
    'import_diagram',
    {
      title: 'Import diagram',
      description:
        'Parse a diagram JSON string, validate it (same checks as validate_diagram), and create it as a new diagram. Refuses to create if validation finds dangling references — call validate_diagram first to see them, fix the JSON, and retry.',
      inputSchema: { title: z.string().min(1), json: z.string(), organizationId: z.string().uuid().optional() },
    },
    async ({ title, json, organizationId }) => {
      let parsed: unknown
      try {
        parsed = JSON.parse(json)
      } catch (e) {
        return errorText(`Invalid JSON: ${e instanceof Error ? e.message : String(e)}`)
      }
      const validated = validateDiagram(parsed)
      if (!validated.ok) {
        return errorText(`Diagram has dangling references, refusing to import:\n${validated.problems.join('\n')}`)
      }
      const client = getClient()
      const resolved = await resolveOrganizationId(client, organizationId)
      if ('error' in resolved) return errorText(resolved.error)
      const { data: row, error } = await client
        .from('diagrams')
        .insert({ title, organization_id: resolved.organizationId, data: validated.diagram })
        .select('*')
        .single()
      if (error) return errorText(error.message)
      return text(row)
    },
  )

  server.registerTool(
    'export_diagram',
    {
      title: 'Export diagram',
      description:
        "Export a diagram as json (the raw data blob), tikz (LaTeX/TikZ source), or html (a self-contained SVG snippet).",
      inputSchema: { id: z.string().uuid(), format: z.enum(['json', 'tikz', 'html']) },
    },
    async ({ id, format }) => {
      const { data: row, error } = await getClient().from('diagrams').select('*').eq('id', id).maybeSingle()
      if (error) return errorText(error.message)
      if (!row) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`)

      const diagram = restoreDiagram(row.data)
      if (format === 'json') return text({ id, format, content: diagram })
      if (format === 'tikz') return text({ id, format, content: diagramToTikzCore(diagram) })
      return text({ id, format, content: diagramToHtmlCore(diagram) })
    },
  )
}
