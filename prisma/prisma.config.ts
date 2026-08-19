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
import { config as loadEnvFile } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { definePrismaConfig } from '@prisma/cli-engine';
import { defineConfig } from '@prisma/orm-postgres/config';

// `dotenv/config` would only read `.env` — this repo keeps local settings in
// `.env.local` (the Next.js convention), so the DIRECT_URL fallback below was
// silently never populated and every local `p8:*` command failed with
// "Database connection is required". Load both, .env.local first: dotenv does
// not overwrite variables that already exist, so .env.local wins locally and
// CI's real environment variables (PRISMA_DB_URL) win everywhere else. Paths
// are resolved against this file, not process.cwd(), so the commands work
// from any directory.
loadEnvFile({ path: fileURLToPath(new URL('../.env.local', import.meta.url)), quiet: true });
loadEnvFile({ path: fileURLToPath(new URL('../.env', import.meta.url)), quiet: true });

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
