import { spawnSync } from 'node:child_process'
import { SUPABASE_DIR } from './paths'
import { assertLocalHost } from './safety'

export interface StackInfo {
  apiUrl: string
  anonKey: string
  serviceRoleKey: string
  dbUrl: string
}

function run(cmd: string, args: string[], cwd: string) {
  return spawnSync(cmd, args, { cwd, encoding: 'utf-8' })
}

export function checkDockerRunning(): { ok: true } | { ok: false; reason: string } {
  const r = run('docker', ['info'], process.cwd())
  if (r.error) return { ok: false, reason: `\`docker\` not found on PATH (${r.error.message})` }
  if (r.status === 0) return { ok: true }
  return { ok: false, reason: (r.stderr || r.stdout || 'docker info exited non-zero').trim() }
}

// Parses `supabase status -o env` output — KEY="value" lines, the same shape
// .github/workflows/preview-db.yml strips quotes from with a `sed` one-liner
// (its own comment explains why: GITHUB_ENV does not strip the quotes `-o
// env` wraps values in). Reimplemented here in plain JS since we're not
// piping through a shell.
function parseEnvOutput(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/)
    if (!m) continue
    let value = m[2]
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1)
    out[m[1]] = value
  }
  return out
}

// The Supabase CLI's default `-o env` variable names (undocumented as a
// stable contract, but consistent across the CLI's own docs/examples and
// widely relied on in community CI setups): API_URL, DB_URL, ANON_KEY,
// SERVICE_ROLE_KEY, plus others (STUDIO_URL, JWT_SECRET, …) we don't need.
// Failing loudly here (rather than silently defaulting) is the point: if a
// future CLI version renames these, this throws with the full key list
// instead of quietly wiring up `undefined`.
const REQUIRED_KEYS = ['API_URL', 'ANON_KEY', 'SERVICE_ROLE_KEY', 'DB_URL'] as const

function toStackInfo(env: Record<string, string>): StackInfo {
  for (const key of REQUIRED_KEYS) {
    if (!env[key]) {
      throw new Error(
        `\`supabase status -o env\` did not include ${key}. Keys seen: ` +
          `${Object.keys(env).join(', ') || '(none — command may have failed)'}. ` +
          'The Supabase CLI may have renamed its default env-output keys — see ' +
          '_tests/e2e-authed/README.md for how to adapt this script (the CLI\'s own ' +
          '`--override-name` flag is the fallback).',
      )
    }
  }
  const info: StackInfo = {
    apiUrl: env.API_URL,
    anonKey: env.ANON_KEY,
    serviceRoleKey: env.SERVICE_ROLE_KEY,
    dbUrl: env.DB_URL,
  }
  assertLocalHost(info.apiUrl, 'local stack API URL')
  assertLocalHost(info.dbUrl, 'local stack DB URL')
  return info
}

// null (not a throw) when the stack simply isn't up yet — that's the normal
// "need to start it" case, distinct from a real failure.
export function getRunningStackInfo(): StackInfo | null {
  const r = run('supabase', ['status', '-o', 'env'], SUPABASE_DIR)
  if (r.error || r.status !== 0) return null
  return toStackInfo(parseEnvOutput(r.stdout))
}

export function startStack(): StackInfo {
  console.log('[e2e-authed] `supabase start` — first run pulls Docker images, can take a few minutes…')
  const r = run('supabase', ['start'], SUPABASE_DIR)
  if (r.status !== 0) {
    const output = `${r.stdout}\n${r.stderr}`
    if (/port is already allocated/i.test(output)) {
      const hint = output.match(/Try stopping the running project with ([^\n]+)/i)?.[1]?.trim()
      throw new Error(
        'Local Supabase stack could not start: one of its fixed ports (54321-54324, ' +
          'per _concept/04-data-schema/config.toml) is already bound by ANOTHER Supabase ' +
          'project running on this machine (a different repo\'s local dev stack).\n\n' +
          (hint
            ? `The Supabase CLI itself suggests: ${hint}\n\n`
            : '') +
          'This script deliberately will NOT stop another project\'s containers for you. ' +
          'If it is safe to, stop that project yourself and re-run ' +
          '`npm run test:e2e:authed:setup`; otherwise those ports need to be freed another ' +
          'way before this lane can run locally.\n\nFull `supabase start` output:\n' +
          output,
      )
    }
    throw new Error(`\`supabase start\` failed:\n${output}`)
  }
  const info = getRunningStackInfo()
  if (!info) {
    throw new Error('`supabase start` reported success, but `supabase status -o env` still failed right after.')
  }
  return info
}

// Never starts a stack we didn't ask for and never touches an already
// running one belonging to another project (see startStack's port-conflict
// branch) — only ensures THIS project's local stack is up, starting it if
// (and only if) it is not already running.
export function ensureLocalStack(): StackInfo {
  const already = getRunningStackInfo()
  if (already) {
    console.log(`[e2e-authed] Local Supabase stack already running at ${already.apiUrl}`)
    return already
  }
  const docker = checkDockerRunning()
  if (!docker.ok) {
    throw new Error(
      `Docker does not appear to be running (${docker.reason}).\n` +
        'Start Docker (Docker Desktop, Colima, etc.) and re-run `npm run test:e2e:authed:setup`. ' +
        'See _tests/e2e-authed/README.md.',
    )
  }
  return startStack()
}
