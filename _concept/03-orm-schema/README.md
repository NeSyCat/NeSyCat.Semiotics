# 03-orm-schema

The ORM layer moved to **Prisma 8** — the schema source of truth is now
`prisma/contract.prisma` at the repo root (see `prisma/README.md` for the
whole pipeline: contract → `db init`/`db update`, the `prisma/sql/` lane for
functions/triggers, and the GitHub Actions that apply everything).

What remains here:

- `SCHEMA.md` — the narrative source of truth (doctrine, invariants, RLS
  rationale), paired with `prisma/contract.prisma` and edited together with it.

The former Drizzle stack (generated `schema.ts`, `codegen/` from the concept
drawing, `drizzle.config.ts`) was retired with the Prisma migration; the
concept drawing itself lives on at `_concept/02-diagram/schema.nesycat.json`.
Regenerating the contract from the drawing is a possible future codegen —
today the contract is edited directly.
