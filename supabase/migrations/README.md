# This directory is intentionally empty

Migrations moved to Prisma (`prisma/`) as of the `feat/prisma-8` branch. The
old Drizzle-generated `.sql` files live on in git history and are archived at
`supabase/migrations-archive/` for reference — do not add new files there.

This directory stays empty on purpose: the Supabase GitHub integration's
migrate step reads `supabase/migrations/` and applies whatever it finds on
every branch (per-PR preview + production on merge to `main`). With nothing
here, that step is a deliberate no-op — schema changes flow through the
Prisma contract instead (see `prisma/README.md`).
