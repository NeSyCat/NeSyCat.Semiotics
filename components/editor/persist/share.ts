// Fragment codec for whole-diagram sharing (quiver.app-style): a diagram
// round-trips through a URL fragment `#d=<scheme>.<base64url>` so recipients
// never touch the server. Scheme `1` deflates via the native
// CompressionStream/DecompressionStream (Baseline-supported, zero deps);
// scheme `0` is the uncompressed fallback when that API is absent. The `.`
// separator sits outside the base64url alphabet, so parsing is unambiguous
// and future schemes stay easy to add.
//
// Auth uses server-side PKCE (`?code=` + cookies), never `#access_token`
// fragments, so `d=` here can never collide with it.

import { restoreDiagram } from './io'
import type { Diagram } from '../domain/types'

const PREFIX = 'd='

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function base64UrlDecode(s: string): Uint8Array {
  const padded = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(s.length + ((4 - (s.length % 4)) % 4), '=')
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new CompressionStream('deflate-raw'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

async function inflate(bytes: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([bytes.slice()]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  const buf = await new Response(stream).arrayBuffer()
  return new Uint8Array(buf)
}

// From an already-stringified diagram — the autosave sink has the JSON in
// hand, so URL sync shouldn't pay a second stringify.
export async function encodeJsonToFragment(json: string): Promise<string> {
  const bytes = new TextEncoder().encode(json)
  if (typeof CompressionStream === 'undefined') {
    return `${PREFIX}0.${base64UrlEncode(bytes)}`
  }
  const compressed = await deflate(bytes)
  return `${PREFIX}1.${base64UrlEncode(compressed)}`
}

export async function encodeDiagramToFragment(d: Diagram): Promise<string> {
  return encodeJsonToFragment(JSON.stringify(d))
}

export async function decodeDiagramFromFragment(hash: string): Promise<Diagram | null> {
  try {
    const raw = hash.startsWith('#') ? hash.slice(1) : hash
    if (!raw.startsWith(PREFIX)) return null
    const body = raw.slice(PREFIX.length)
    const dot = body.indexOf('.')
    if (dot < 0) return null
    const scheme = body.slice(0, dot)
    const payload = base64UrlDecode(body.slice(dot + 1))
    let bytes: Uint8Array
    if (scheme === '0') {
      bytes = payload
    } else if (scheme === '1') {
      if (typeof DecompressionStream === 'undefined') return null
      bytes = await inflate(payload)
    } else {
      return null
    }
    const json = new TextDecoder().decode(bytes)
    return restoreDiagram(JSON.parse(json))
  } catch {
    return null
  }
}
