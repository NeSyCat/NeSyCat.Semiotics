import { z } from 'zod'
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import { text, errorText } from './result.js'
import { restoreDiagram } from '../../../components/editor/persist/io.js'
import { SHAPES } from '../../../components/editor/domain/forms.js'
import type { Diagram, Shape } from '../../../components/editor/domain/types.js'
import { addFormOp, addPointOp, addLineOp, removeElementOp, setElementNameOp, moveFormOp, type OpResult } from '../diagram/ops.js'

const ShapeEnum = z.enum(SHAPES as unknown as [Shape, ...Shape[]])
const ColorSchema = z.tuple([z.number().min(0).max(1), z.number().min(0).max(1), z.number().min(0).max(1)])
const PositionSchema = z.object({ x: z.number(), y: z.number() })
const KindEnum = z.enum(['form', 'point', 'line'])

// Shared load -> pure op -> save round trip every drawing tool below runs:
// fetch the row, normalize its `data` into a Diagram (restoreDiagram), hand
// it to the pure op (diagram/ops.ts — the part mcp/test/*.test.ts exercises
// directly), then write the op's own already-`restoreDiagram`d result back.
async function withDiagram(
  client: SupabaseClient,
  diagramId: string,
  op: (d: Diagram) => OpResult,
): Promise<CallToolResult> {
  const { data: row, error: getError } = await client.from('diagrams').select('*').eq('id', diagramId).maybeSingle()
  if (getError) return errorText(getError.message)
  if (!row) return errorText(`No diagram found with id ${diagramId} (or you are not a member of its organization)`)

  const current = restoreDiagram(row.data)
  const result = op(current)
  if (!result.ok) return errorText(result.error)

  const { data: updated, error: updateError } = await client
    .from('diagrams')
    .update({ data: result.diagram, updated_at: new Date().toISOString() })
    .eq('id', diagramId)
    .select('*')
    .maybeSingle()
  if (updateError) return errorText(updateError.message)
  if (!updated) return errorText(`Diagram ${diagramId} disappeared during update.`)
  return text(result.id ? { ...updated, newId: result.id } : updated)
}

export function registerDrawingTools(server: McpServer, getClient: () => SupabaseClient) {
  server.registerTool(
    'add_form',
    {
      title: 'Add form',
      description: 'Add a new form (a "big shape": triangle/square/circle/rhombus/empty) to a diagram.',
      inputSchema: {
        diagramId: z.string().uuid(),
        shape: ShapeEnum,
        position: PositionSchema.optional().describe('Defaults to {x:0,y:0}.'),
        name: z.string().optional(),
        color: ColorSchema.optional().describe('[r,g,b], each 0..1.'),
      },
    },
    async ({ diagramId, shape, position, name, color }) =>
      withDiagram(getClient(), diagramId, (d) => addFormOp(d, { shape, position, name, color })),
  )

  server.registerTool(
    'add_point',
    {
      title: 'Add point',
      description:
        "Add a point on one of a form's edges, corners, or centre spots. The edgeKey must be valid for that form's shape — sides plus vertex/centre spots: square top/right/bottom/left + corners corner-tl/corner-tr/corner-br/corner-bl + centres center-up/center-down; rhombus top-right/bottom-right/bottom-left/top-left + corners corner-top/corner-right/corner-bottom/corner-left + center-up/center-down; triangle a/b/c + apex peak + base corners corner-base-top/corner-base-bottom; circle up/right/down/left + center-up/center-down; empty self. Corner and centre spots hold at most one point each. An invalid edgeKey is rejected with the valid list for that shape.",
      inputSchema: {
        diagramId: z.string().uuid(),
        formId: z.string(),
        edgeKey: z.string(),
        name: z.string().optional(),
        shape: ShapeEnum.optional().describe("The point's own small glyph shape; defaults to 'empty' (no glyph)."),
      },
    },
    async ({ diagramId, formId, edgeKey, name, shape }) =>
      withDiagram(getClient(), diagramId, (d) => addPointOp(d, { formId, edgeKey, name, shape })),
  )

  server.registerTool(
    'add_line',
    {
      title: 'Add line',
      description: 'Add a line (a hyperedge: one source point, one or more target points) between existing points.',
      inputSchema: {
        diagramId: z.string().uuid(),
        sourcePointId: z.string(),
        targetPointIds: z.array(z.string()).min(1),
        name: z.string().optional(),
      },
    },
    async ({ diagramId, sourcePointId, targetPointIds, name }) =>
      withDiagram(getClient(), diagramId, (d) => addLineOp(d, { sourcePointId, targetPointIds, name })),
  )

  server.registerTool(
    'remove_element',
    {
      title: 'Remove element',
      description:
        'Remove a form, point, or line by id. Removing a form also removes its points and any lines that touched them; removing a point does the same for lines touching just it.',
      inputSchema: { diagramId: z.string().uuid(), kind: KindEnum, id: z.string() },
    },
    async ({ diagramId, kind, id }) => withDiagram(getClient(), diagramId, (d) => removeElementOp(d, kind, id)),
  )

  server.registerTool(
    'set_element_name',
    {
      title: 'Set element name',
      description: 'Rename a form, point, or line. An empty string clears the name back to the default (id fallback).',
      inputSchema: { diagramId: z.string().uuid(), kind: KindEnum, id: z.string(), name: z.string() },
    },
    async ({ diagramId, kind, id, name }) => withDiagram(getClient(), diagramId, (d) => setElementNameOp(d, kind, id, name)),
  )

  server.registerTool(
    'move_form',
    {
      title: 'Move form',
      description: "Move a form to a new canvas position (its own x/y — doesn't affect its points/lines' logical structure).",
      inputSchema: { diagramId: z.string().uuid(), formId: z.string(), position: PositionSchema },
    },
    async ({ diagramId, formId, position }) => withDiagram(getClient(), diagramId, (d) => moveFormOp(d, formId, position)),
  )
}
