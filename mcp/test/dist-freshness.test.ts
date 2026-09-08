// Staleness guard, wired into `npx vitest run`: rebuilds every bundle entry
// point into a temp dir and byte-diffs it against the committed mcp/dist/.
// See scripts/check-dist-freshness.mjs for how the comparison itself works.
// This is the ONE test in the suite whose failure means "you edited a
// source file (mcp/src/**, or the out-of-package components/editor/* the
// bundle inlines) without running `npm run bundle`" — see the ticket's
// acceptance check 5, which requires proving this test actually goes red
// on drift and green again once dist/ is rebuilt.
import { describe, it, expect } from 'vitest'
import { checkDistFreshness } from '../scripts/check-dist-freshness.mjs'

describe('dist/ staleness guard', () => {
  it('matches a fresh rebuild from current sources', async () => {
    const { fresh, diffs } = await checkDistFreshness()
    expect(fresh, `dist/ is stale — run \`npm run bundle\`:\n${diffs.join('\n')}`).toBe(true)
  })
})
