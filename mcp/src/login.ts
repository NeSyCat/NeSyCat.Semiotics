#!/usr/bin/env node
// `npm run login` — browser-based GitHub OAuth (Supabase PKCE flow) via a
// loopback redirect, the standard flow for a CLI/local tool that can't host
// a real HTTPS callback: this process itself briefly listens on
// http://localhost:<SEMIOTICS_LOGIN_PORT>/callback (default 8976) to catch
// the `?code=` Supabase redirects back with, then exchanges it for a
// session and saves it to mcp/.session.json via the file-backed storage
// adapter (supabase/session-storage.ts) — the SAME client construction
// index.ts/whoami.ts/logout.ts use, so every one of those later reads the
// session this saves.
//
// NOTE: the redirect URL below must be allow-listed in Supabase — Auth →
// URL Configuration → Redirect URLs — or `signInWithOAuth` will succeed but
// GitHub's own redirect back will be rejected by Supabase. Out of scope for
// this server to configure; see mcp/README.md.
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { getSupabaseClient, loginPort } from './supabase/client.js'

const CALLBACK_HTML = (ok: boolean, detail: string) => `<!doctype html>
<html><body style="font-family: ui-sans-serif, system-ui; padding: 2rem;">
<h2>${ok ? 'Signed in' : 'Sign-in failed'}</h2>
<p>${detail}</p>
<p>You may close this tab and return to the terminal.</p>
</body></html>`

// Best-effort browser open — mac `open`, linux `xdg-open`, windows `start`
// (via cmd.exe, which `start` requires as a builtin). No extra dependency:
// every platform this server is likely to run on already ships one of
// these launchers, so a tiny `open`-style npm package would only save this
// one three-way switch.
function openBrowser(url: string) {
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'cmd' : 'xdg-open'
  const args = platform === 'win32' ? ['/c', 'start', '""', url] : [url]
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref()
  } catch {
    // fall through — the URL is printed below regardless
  }
}

async function main() {
  const client = getSupabaseClient()
  const port = loginPort()
  const redirectTo = `http://localhost:${port}/callback`

  const { data, error } = await client.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo, skipBrowserRedirect: true },
  })
  if (error || !data.url) {
    console.error('Failed to start sign-in:', error?.message ?? 'no authorization URL returned')
    process.exitCode = 1
    return
  }

  const result = await new Promise<{ ok: boolean; message: string }>((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? '/', `http://localhost:${port}`)
      if (url.pathname !== '/callback') {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get('code')
      const oauthError = url.searchParams.get('error_description') ?? url.searchParams.get('error')
      if (!code) {
        const message = oauthError ?? 'No authorization code in the callback URL.'
        res.writeHead(400, { 'Content-Type': 'text/html' }).end(CALLBACK_HTML(false, message))
        server.close(() => resolve({ ok: false, message }))
        return
      }
      client.auth
        .exchangeCodeForSession(code)
        .then(({ error: exchangeError }) => {
          if (exchangeError) {
            res.writeHead(400, { 'Content-Type': 'text/html' }).end(CALLBACK_HTML(false, exchangeError.message))
            server.close(() => resolve({ ok: false, message: exchangeError.message }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'text/html' }).end(CALLBACK_HTML(true, 'Session saved to mcp/.session.json.'))
          server.close(() => resolve({ ok: true, message: 'Session saved.' }))
        })
        .catch((e: unknown) => {
          const message = e instanceof Error ? e.message : String(e)
          res.writeHead(500, { 'Content-Type': 'text/html' }).end(CALLBACK_HTML(false, message))
          server.close(() => resolve({ ok: false, message }))
        })
    })
    server.listen(port, () => {
      console.log(`Waiting for the GitHub sign-in to complete at http://localhost:${port}/callback ...`)
      console.log(`If the browser did not open automatically, visit:\n${data.url}`)
      openBrowser(data.url)
    })
  })

  if (!result.ok) {
    console.error('Login failed:', result.message)
    process.exitCode = 1
    return
  }

  const { data: userData } = await client.auth.getUser()
  console.log(`Logged in as ${userData.user?.email ?? userData.user?.id ?? '(unknown user)'}.`)
}

await main()
