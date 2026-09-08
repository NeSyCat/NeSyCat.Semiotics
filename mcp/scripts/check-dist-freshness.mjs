// Staleness guard: rebuilds every bundle entry point into a throwaway temp
// directory (using the exact same esbuild.config.mjs `bundle()` the real
// `npm run bundle` uses) and byte-diffs the result against the committed
// mcp/dist/*.js. If dist/ was hand-edited, or a source file it inlines
// (src/** or the out-of-package components/editor/* it pulls in) changed
// without a rebuild, the committed bundle and the freshly-rebuilt one
// diverge and this fails — catching drift before a plugin install ships a
// stale dist/.
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { bundle, ENTRY_POINTS } from '../esbuild.config.mjs'

const MCP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const DIST_DIR = path.join(MCP_ROOT, 'dist')

function entryOutputName(entry) {
  // 'src/index.ts' -> 'index.js'
  return path.basename(entry, path.extname(entry)) + '.js'
}

export async function checkDistFreshness() {
  const tmp = await mkdtemp(path.join(tmpdir(), 'nsp-dist-check-'))
  const diffs = []
  try {
    await bundle({ outdir: tmp })

    for (const entry of ENTRY_POINTS) {
      const name = entryOutputName(entry)
      const committedPath = path.join(DIST_DIR, name)
      const freshPath = path.join(tmp, name)

      let committed
      try {
        committed = await readFile(committedPath, 'utf8')
      } catch {
        diffs.push(`${name}: missing from committed dist/ (expected at ${committedPath})`)
        continue
      }

      const fresh = await readFile(freshPath, 'utf8')
      if (committed !== fresh) {
        diffs.push(
          `${name}: committed dist/${name} does not match a fresh rebuild ` +
            `(committed ${committed.length} bytes, fresh ${fresh.length} bytes) — run \`npm run bundle\`.`
        )
      }
    }
  } finally {
    await rm(tmp, { recursive: true, force: true })
  }

  return { fresh: diffs.length === 0, diffs }
}

// CLI entry: `node scripts/check-dist-freshness.mjs`
if (import.meta.url === `file://${process.argv[1]}`) {
  const { fresh, diffs } = await checkDistFreshness()
  if (fresh) {
    console.log('dist/ is fresh: matches a rebuild from current sources.')
    process.exit(0)
  } else {
    console.error('dist/ is STALE:')
    for (const d of diffs) console.error(`  - ${d}`)
    process.exit(1)
  }
}
