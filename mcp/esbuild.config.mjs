// Bundles the four CLI entry points (src/index.ts, src/login.ts,
// src/whoami.ts, src/logout.ts) into standalone dist/*.js files so the
// plugin works when `claude plugin install` copies ONLY mcp/ into a
// detached plugin cache: the server's source reaches OUTSIDE mcp/ via
// relative imports into ../components/editor/* (the headless editor core),
// and those files do not exist in the copied tree unless we inline them.
//
// Bare npm packages (@modelcontextprotocol/sdk, @supabase/supabase-js,
// dotenv, zod) stay EXTERNAL — they ship in mcp/node_modules, which IS
// copied verbatim by `claude plugin install`, and the SDK/supabase-js in
// particular are not safe to bundle (dynamic requires).
//
// Exported as a function so both `npm run bundle` (writes to dist/) and the
// staleness guard (writes to a throwaway temp dir, then diffs) share one
// build definition.
import { build } from 'esbuild'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const MCP_ROOT = path.dirname(fileURLToPath(import.meta.url))

export const ENTRY_POINTS = ['src/index.ts', 'src/login.ts', 'src/whoami.ts', 'src/logout.ts']

// esbuild already resolves a TypeScript-authored `./foo.js` specifier to
// `./foo.ts` on disk when no `foo.js` exists (same rule tsc itself applies
// under moduleResolution "bundler"/"node16"+) — this project's source
// leans on that everywhere (e.g. `../../../components/editor/persist/io.js`
// -> io.ts), so no custom resolver is needed for it. See the smoke-tested
// bundle output for confirmation (no unresolved-import errors).

export async function bundle({ outdir }) {
  await build({
    absWorkingDir: MCP_ROOT,
    entryPoints: ENTRY_POINTS,
    outdir,
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    packages: 'external', // keep bare npm deps external — they ship in node_modules/
    sourcemap: false,
    logLevel: 'silent',
  })
}

// CLI entry: `node esbuild.config.mjs [outdir]` (default dist)
if (import.meta.url === `file://${process.argv[1]}`) {
  const outdir = process.argv[2] ? path.resolve(process.argv[2]) : path.join(MCP_ROOT, 'dist')
  await bundle({ outdir })
  console.log(`Bundled ${ENTRY_POINTS.join(', ')} -> ${path.relative(MCP_ROOT, outdir) || '.'}`)
}
