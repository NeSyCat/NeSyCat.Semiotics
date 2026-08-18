// Golden test for _concept/03-orm-schema/codegen/diagram-to-drizzle.ts.
//
// Regenerates schema.ts from the committed diagram into a scratch dir and
// asserts it's byte-identical to the committed _concept/03-orm-schema/schema.ts.
// This pins two things at once: the generator is idempotent (running it twice
// on the same diagram never drifts), and the committed schema.ts hasn't gone
// stale relative to the diagram (the same check `npm run db:diagram && git
// diff --exit-code _concept/03-orm-schema/schema.ts` does manually, gate 1 in
// the org-model design doc).
//
// No unit test for the membership-pattern classification below — the
// generator doesn't expose its internal table-building/classification as
// separately importable pieces (everything lives in main()), and refactoring
// it to do so is out of scope here. This golden test already exercises that
// logic end-to-end via the Organization/Membership rectangles in the diagram.

import { execSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('diagram-to-drizzle codegen (golden)', () => {
  it('regenerating schema.ts from the diagram reproduces the committed output byte-for-byte', () => {
    const repoRoot = process.cwd()
    const tmpDir = mkdtempSync(join(tmpdir(), 'nesycat-codegen-golden-'))
    const outPath = join(tmpDir, 'schema.ts')

    try {
      execSync(`npx tsx _concept/03-orm-schema/codegen/diagram-to-drizzle.ts _concept/02-diagram/schema.nesycat.json "${outPath}"`, {
        cwd: repoRoot,
        stdio: 'pipe',
      })

      const generated = readFileSync(outPath, 'utf8')
      const committed = readFileSync(join(repoRoot, '_concept/03-orm-schema/schema.ts'), 'utf8')

      expect(
        generated,
        'generator output must match the committed schema.ts — if this fails, either the diagram or the generator changed without regenerating (run `npm run db:diagram`)',
      ).toBe(committed)
    } finally {
      rmSync(tmpDir, { recursive: true, force: true })
    }
  })
})
