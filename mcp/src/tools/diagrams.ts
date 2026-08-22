import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import { text, errorText } from './result.js'
import { resolveOrganizationId } from './org-resolve.js'
import { restoreDiagram } from '../vendor/editor/persist/io.js'
import { emptyDiagram } from '../diagram/defaults.js'
import { duplicateData, duplicateTitle } from '../diagram/ops.js'

// `data` arrives from an LLM caller as arbitrary JSON — always run it
// through restoreDiagram (persist/io.ts) before it ever reaches a write, the
// same load-boundary normalization the editor itself applies to anything
// coming out of `diagrams.data` jsonb.
const dataSchema = z.unknown().describe('The diagram document (Diagram JSON: schemaVersion/forms/points/lines).')

export function registerDiagramTools(server: McpServer, getClient: () => SupabaseClient) {
  server.registerTool(
    'list_diagrams',
    {
      title: 'List diagrams',
      description:
        'List diagrams (id, title, organization, last updated) — RLS-scoped to the organizations the signed-in user belongs to. Pass organizationId to narrow to one.',
      inputSchema: { organizationId: z.string().uuid().optional() },
    },
    async ({ organizationId }) => {
      let query = getClient().from('diagrams').select('id, title, organization_id, updated_at').order('updated_at', { ascending: false })
      if (organizationId) query = query.eq('organization_id', organizationId)
      const { data, error } = await query
      if (error) return errorText(error.message)
      return text(data)
    },
  )

  server.registerTool(
    'get_diagram',
    {
      title: 'Get diagram',
      description: 'Fetch one diagram in full, including its data (forms/points/lines).',
      inputSchema: { id: z.string().uuid() },
    },
    async ({ id }) => {
      const { data, error } = await getClient().from('diagrams').select('*').eq('id', id).maybeSingle()
      if (error) return errorText(error.message)
      if (!data) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`)
      return text(data)
    },
  )

  server.registerTool(
    'create_diagram',
    {
      title: 'Create diagram',
      description:
        'Create a new diagram. organizationId is optional — falls back to SEMIOTICS_DEFAULT_ORG, then to the user\'s only organization if unambiguous; otherwise call list_organizations and pass one explicitly. `data` defaults to an empty diagram.',
      inputSchema: { title: z.string().min(1), organizationId: z.string().uuid().optional(), data: dataSchema.optional() },
    },
    async ({ title, organizationId, data }) => {
      const client = getClient()
      const resolved = await resolveOrganizationId(client, organizationId)
      if ('error' in resolved) return errorText(resolved.error)
      const diagramData = restoreDiagram(data ?? emptyDiagram())
      const { data: row, error } = await client
        .from('diagrams')
        .insert({ title, organization_id: resolved.organizationId, data: diagramData })
        .select('*')
        .single()
      if (error) return errorText(error.message)
      return text(row)
    },
  )

  server.registerTool(
    'update_diagram',
    {
      title: 'Update diagram',
      description: "Full replace of a diagram's data, after restoreDiagram validation/normalization.",
      inputSchema: { id: z.string().uuid(), data: dataSchema },
    },
    async ({ id, data }) => {
      const diagramData = restoreDiagram(data)
      const { data: row, error } = await getClient()
        .from('diagrams')
        .update({ data: diagramData, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .maybeSingle()
      if (error) return errorText(error.message)
      if (!row) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`)
      return text(row)
    },
  )

  server.registerTool(
    'rename_diagram',
    {
      title: 'Rename diagram',
      description: "Change a diagram's title only.",
      inputSchema: { id: z.string().uuid(), title: z.string().min(1) },
    },
    async ({ id, title }) => {
      const { data: row, error } = await getClient()
        .from('diagrams')
        .update({ title, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .maybeSingle()
      if (error) return errorText(error.message)
      if (!row) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`)
      return text(row)
    },
  )

  server.registerTool(
    'delete_diagram',
    {
      title: 'Delete diagram',
      description: 'Permanently delete a diagram. Requires confirm:true — refuses otherwise.',
      inputSchema: { id: z.string().uuid(), confirm: z.boolean() },
    },
    async ({ id, confirm }) => {
      if (!confirm) return errorText('Refusing to delete without confirm:true.')
      const { data: row, error } = await getClient().from('diagrams').delete().eq('id', id).select('id').maybeSingle()
      if (error) return errorText(error.message)
      if (!row) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`)
      return text({ deleted: true, id })
    },
  )

  server.registerTool(
    'duplicate_diagram',
    {
      title: 'Duplicate diagram',
      description: 'Copy a diagram (its data, unchanged) into a new row in the same organization. Title defaults to "<title> (copy)".',
      inputSchema: { id: z.string().uuid(), title: z.string().min(1).optional() },
    },
    async ({ id, title }) => {
      const client = getClient()
      const { data: original, error: getError } = await client.from('diagrams').select('*').eq('id', id).maybeSingle()
      if (getError) return errorText(getError.message)
      if (!original) return errorText(`No diagram found with id ${id} (or you are not a member of its organization)`)
      const copiedData = duplicateData(restoreDiagram(original.data))
      const { data: row, error } = await client
        .from('diagrams')
        .insert({
          title: duplicateTitle(original.title, title),
          organization_id: original.organization_id,
          data: copiedData,
        })
        .select('*')
        .single()
      if (error) return errorText(error.message)
      return text(row)
    },
  )
}
