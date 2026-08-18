// Prisma 8 ("Prisma Next") project config.
//
// Adapted from the spike's prisma-next.config.ts (see
// .foreman/scratch/design-prisma8-v3.md). The datasource URL is NEVER
// hardcoded here: PRISMA_DB_URL is the primary env var (set per-environment
// by CI — prod secret, per-PR Supabase preview branch URL), falling back to
// DIRECT_URL for local dev where .env.local already defines it for Drizzle.
//
// .mts extension quirk: this repo's package.json has no "type" field (Next.js
// app, left as CommonJS default per CLAUDE.md) but this file uses ESM import/
// export syntax, so it is named prisma.config.ts and loaded by the Prisma CLI
// through its own bundler — not by plain `node`. If a future toolchain change
// makes the CLI load config files via plain Node module resolution, rename
// this file to prisma.config.mts to force ESM parsing without touching
// package.json's module type.
import 'dotenv/config';
import { fileURLToPath } from 'node:url';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig } from '@prisma/orm-postgres/config';

// Resolved relative to this file (not process.cwd()) — the CLI derives
// sibling paths (package.json lookups, emit output) from the contract path
// and rejects relative ones on this build, so this must be absolute.
const contractPath = fileURLToPath(new URL('./contract.prisma', import.meta.url));

export default definePrismaConfig({
  orm: defineConfig({
    contract: contractPath,
    db: {
      connection: process.env.PRISMA_DB_URL ?? process.env.DIRECT_URL,
    },
  }),
});
