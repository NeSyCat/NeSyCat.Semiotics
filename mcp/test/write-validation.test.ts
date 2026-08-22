import { describe, it, expect, vi } from 'vitest'
import { registerDiagramTools } from '../src/tools/diagrams.js'

// A diagram whose single line points at points that don't exist — must be
// rejected by create_diagram and update_diagram (regression guard: these two
// write paths previously only normalized, not referentially validated).
const danglingDiagram = {
  schemaVersion: 1,
  forms: [],
  points: {},
  lines: [{ id: 'l1', source: 'ghost-a', targets: ['ghost-b'] }],
}

// Minimal fake McpServer that captures registered tool handlers by name.
function fakeServer() {
  const handlers: Record<string, (args: any) => Promise<any>> = {}
  const server = { registerTool: (name: string, _def: unknown, handler: (a: any) => Promise<any>) => { handlers[name] = handler } }
  return { server: server as any, handlers }
}

// A client that throws if any DB write is reached — proves validation short-circuits before the write.
function explodingClient() {
  return { from: () => { throw new Error('DB write must not be reached when validation fails') } } as any
}

describe('create/update reject dangling references before writing', () => {
  const { server, handlers } = fakeServer()
  registerDiagramTools(server, () => explodingClient())

  it('update_diagram refuses a diagram with dangling line refs', async () => {
    const res = await handlers['update_diagram']({ id: '00000000-0000-0000-0000-000000000000', data: danglingDiagram })
    expect(res.isError).toBe(true)
    expect(String(res.content?.[0]?.text)).toMatch(/dangling references/i)
  })

  it('create_diagram refuses a diagram with dangling line refs before any DB call', async () => {
    // validation runs first, so the exploding client is never reached
    const res = await handlers['create_diagram']({ title: 'x', organizationId: '00000000-0000-0000-0000-000000000000', data: danglingDiagram })
    expect(res.isError).toBe(true)
    expect(String(res.content?.[0]?.text)).toMatch(/dangling references/i)
  })
})
