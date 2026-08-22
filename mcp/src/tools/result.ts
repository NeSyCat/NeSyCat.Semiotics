import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'

/** Wrap a JS value as the tool's single text content block. */
export function text(value: unknown): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] }
}

/** A tool-level failure (bad input, missing row, RLS denied it) — reported
 * to the model as a normal tool result with isError, not a thrown protocol
 * error (mirrors the Admination Management MCP's tools/result.ts). */
export function errorText(message: string): CallToolResult {
  return { content: [{ type: 'text', text: message }], isError: true }
}
