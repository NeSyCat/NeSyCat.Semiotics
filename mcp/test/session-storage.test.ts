import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createFileStorage, deleteSessionFile } from '../src/supabase/session-storage.js'

let dir: string

afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true })
})

describe('file-backed session storage', () => {
  it('round-trips a value through setItem/getItem', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'semiotics-mcp-test-'))
    const file = path.join(dir, '.session.json')
    const storage = createFileStorage(file)

    expect(await storage.getItem('sb-session')).toBeNull()

    await storage.setItem('sb-session', JSON.stringify({ access_token: 'abc123' }))
    expect(await storage.getItem('sb-session')).toBe(JSON.stringify({ access_token: 'abc123' }))

    // Survives a fresh adapter instance over the same file (simulates a
    // separate `whoami`/`start` process reading what `login` wrote).
    const reopened = createFileStorage(file)
    expect(await reopened.getItem('sb-session')).toBe(JSON.stringify({ access_token: 'abc123' }))
  })

  it('removeItem clears just that key, leaving others intact', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'semiotics-mcp-test-'))
    const file = path.join(dir, '.session.json')
    const storage = createFileStorage(file)

    await storage.setItem('a', '1')
    await storage.setItem('b', '2')
    await storage.removeItem('a')

    expect(await storage.getItem('a')).toBeNull()
    expect(await storage.getItem('b')).toBe('2')
  })

  it('removeItem on a missing file/key is a no-op, not a throw', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'semiotics-mcp-test-'))
    const file = path.join(dir, 'nested', '.session.json')
    const storage = createFileStorage(file)
    await expect(storage.removeItem('anything')).resolves.toBeUndefined()
  })

  it('deleteSessionFile removes the whole file', () => {
    dir = mkdtempSync(path.join(tmpdir(), 'semiotics-mcp-test-'))
    const file = path.join(dir, '.session.json')
    writeFileSync(file, '{}')
    expect(existsSync(file)).toBe(true)
    deleteSessionFile(file)
    expect(existsSync(file)).toBe(false)
  })

  it('a corrupt session file is treated as empty rather than throwing', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'semiotics-mcp-test-'))
    const file = path.join(dir, '.session.json')
    writeFileSync(file, '{ not valid json')
    const storage = createFileStorage(file)
    expect(await storage.getItem('x')).toBeNull()
    await storage.setItem('x', 'y')
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ x: 'y' })
  })
})
