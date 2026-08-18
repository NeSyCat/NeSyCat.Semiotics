// Prisma's CLI auto-discovers `prisma.config.ts` at the repo root only —
// the real config lives with the rest of the Prisma project in prisma/.
// This re-export exists so every invocation (CI workflows, npm scripts,
// bare `npx prisma ...`) resolves the config without a --config flag.
export { default } from './prisma/prisma.config'
