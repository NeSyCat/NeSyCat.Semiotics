#!/usr/bin/env node
// Local MCP server for NeSyCat Semiotics — full CRUD + drawing control over
// diagrams, authenticated AS the signed-in user via @supabase/supabase-js
// (anon key + the saved session from `npm run login`), so Postgres RLS
// scopes every query to that user's organizations. UNLIKE the Admination
// Management MCP this mirrors in shape (McpServer + StdioServerTransport,
// one tools/<area>.ts per area, zod input schemas), this server does NOT
// bypass RLS — there is no service-role key, no DATABASE_URL, no direct
// Postgres connection anywhere in this package. See ../README.md for setup.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { getSupabaseClient } from './supabase/client.js'
import { registerWhoamiTools } from './tools/whoami.js'
import { registerOrganizationTools } from './tools/organizations.js'
import { registerDiagramTools } from './tools/diagrams.js'
import { registerDrawingTools } from './tools/drawing.js'
import { registerValidateTools } from './tools/validate.js'
import { registerImportExportTools } from './tools/import_export.js'

const server = new McpServer({ name: 'nesycat-semiotics', version: '0.1.0' })

// Lazily constructed on first tool call, not at import time — keeps this
// module importable (e.g. by a future test) without SUPABASE_URL/
// SUPABASE_ANON_KEY set, and constructing the client itself does no network
// I/O (see supabase/client.ts).
const getClient = () => getSupabaseClient()

registerWhoamiTools(server, getClient)
registerOrganizationTools(server, getClient)
registerDiagramTools(server, getClient)
registerDrawingTools(server, getClient)
registerValidateTools(server)
registerImportExportTools(server, getClient)

const transport = new StdioServerTransport()
await server.connect(transport)
