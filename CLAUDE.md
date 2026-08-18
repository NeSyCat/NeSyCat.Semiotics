# NeSyCat.Semiotics — Claude Code instructions

## Scope

This repo is **only** the Semiotics editor (the in-browser string-diagram tool),
deployed at `https://semiotics.nesycat.org`. The umbrella marketing/info site
for the NeSyCat project as a whole lives in the sibling repo `NeSyCat.Web`,
deployed at `https://nesycat.org`. Don't reintroduce marketing copy here — it
belongs on `nesycat.org`.

## This is NOT the Next.js you know

Next.js 16.2.4 has breaking changes — APIs, conventions, and file structure
may all differ from your training data. Read the relevant guide in
`node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## Folder taxonomy

The repo mirrors the project taxonomy from `_concept/02-diagram/schema.nesycat.json`.

- **Tech stays at root** — `app/`, `components/`, `lib/`, `public/` are pinned
  by Next.js or are runtime app code.
- **`_concept/`** — schema-building pipeline. Anything you'd produce on the
  way to "get a schema into Supabase" lives here, even `.ts`. The principle:
  imagine no app exists yet — what would you still need? That's concept.
  - `01-idea/` — raw ideas, sketches
  - `02-diagram/schema.nesycat.json` — source of truth for the data model
  - `03-orm-schema/` — generated Drizzle `schema.ts` + SQL `migrations/` + `codegen/` tool
  - `04-data-schema/` — Supabase `config.toml`
- **`_design/`** — visual design pipeline (sketch → wireframe → mockup → prototype). HTML.
- **`_tests/`** — manual / file (Vitest) / e2e / main buckets. `file/` runs via `npm test` (Vitest); manual/e2e/main runners not yet wired.

The underscore prefix sorts these meta folders to the top of file-tree listings.

## Schema flow

```
_concept/02-diagram/schema.nesycat.json   (you edit this)
        │
        ▼  npm run db:diagram
_concept/03-orm-schema/schema.ts          (generated — DO NOT EDIT)
        │
        ▼  npm run db:generate            (drizzle-kit generate)
supabase/migrations/*.sql                 (real files; _concept path is a symlink)
        │
        ▼  merge to main                  (Supabase GitHub integration,
        │                                  "Deploy to production" ON)
Supabase Postgres (production)
```

Supabase applies migrations automatically: to a per-PR PREVIEW branch on PR
open, and to PRODUCTION on merge to `main`. After merging a schema PR,
VERIFY the apply actually happened (check `supabase_migrations.
schema_migrations` or the tables). If a merge fails to apply, the manual
fallback is `npm run db:migrate` (drizzle-kit migrate over `DIRECT_URL`) —
migrations 0000–0004 are baselined in both tracking systems
(`drizzle.__drizzle_migrations` and `supabase_migrations.schema_migrations`)
precisely so the fallback and the integration never double-apply.

`lib/db/index.ts` (drizzle client + `withRLS()`) and `lib/supabase/*` (auth
SDK clients + middleware) are the **runtime** glue — they consume what
`_concept/` defines. Don't move them; don't conflate them with concept.

## Why there's a `supabase/` folder at root

Supabase's GitHub integration auto-applies migrations from
`<workdir>/supabase/migrations/` and reads config from
`<workdir>/supabase/config.toml`. Its working dir is `.` (repo root), so it
looks at the root. Our canonical locations are deeper, per the `_concept/`
taxonomy — bridged by symlinks, whose DIRECTION matters:

- migrations: REAL files live in `supabase/migrations/` (Drizzle's `out:`
  path `_concept/03-orm-schema/migrations` is a symlink into it, so the
  taxonomy path keeps working). The integration's change detection reads
  git DIFF PATHS, and a diff never contains paths behind a symlink — with
  the real files on the `_concept/` side (the original layout), every
  migration PR reported "No changes detected in `supabase` directory" and
  Supabase skipped branching entirely (discovered on PR #95). Real files
  must stay on the `supabase/` side.
- config: `supabase/config.toml` is still a symlink to the real
  `_concept/04-data-schema/config.toml`. The integration READS it fine
  (symlinks resolve in a checkout; only diff detection is blind to them),
  but a config-only change won't trigger a Supabase run on its own.

Drizzle remains the single source of truth for migrations; it just writes
through the `_concept/` symlink now.

## Branch + PR strategy

- PRs go straight to `main` — there's no `staging` integration branch (retired;
  each PR already gets its own Vercel preview + Supabase preview branch, which
  covered what `staging` was for).
- Don't push directly to `main`.
- The repo lives at `NeSyCat/NeSyCat.Semiotics` on GitHub (origin URL still
  redirects from `cherryfunk/semiotics.nesycat` — both work).

## Tooling quirks worth knowing

- **Tailwind v4 / Lightning CSS** silently strips `:not(.unused-class)` from
  selectors when the excluded class isn't used as a standalone selector
  elsewhere. Use override-and-undo (hide all, then re-show specific) instead
  of `:not()` exemptions. See `app/globals.css` `.points-hidden` block.
- **Supabase CLI** looks for `supabase/config.toml` relative to cwd. Since the
  config now lives at `_concept/04-data-schema/`, run `cd _concept/04-data-schema`
  before any `supabase` CLI command.
- **Drizzle**: `drizzle.config.ts` lives at `_concept/03-orm-schema/drizzle.config.ts`
  (with the rest of the Drizzle stack). The `db:*` scripts in `package.json`
  pass `--config _concept/03-orm-schema/drizzle.config.ts`. Always invoke them
  via `npm run db:…` so cwd stays at repo root and `.env.local` resolves.
  `db:migrate` applies to production over `DIRECT_URL` — it is the manual
  FALLBACK for when a merge fails to auto-apply; don't run it routinely.
- **Vercel can't fetch private git submodules** — `admination-design-system`
  (a `file:` dependency into `vendor/Admination.02-Design`, a submodule
  pointing at the private `Admination-de/design.admination`) clones empty on
  Vercel, failing the build with `Module not found:
  admination-design-system/components/index.css`. This isn't a GitHub App
  permissions gap — Vercel's docs are explicit that private submodules fail
  during the Build step regardless of grants. `scripts/vercel-prebuild.sh`
  re-fetches it over an authenticated HTTPS rewrite using the
  `ADMINATION_DS_TOKEN` env var (a fine-grained PAT scoped to read-only
  access on that one repo, set in the Vercel project's environment
  variables) before `next build` runs. No-ops locally where that env var
  isn't set, since the submodule is already checked out there.

## Deployment

- Production: `https://semiotics.nesycat.org`
- The umbrella site `https://nesycat.org` (and `https://www.nesycat.org`) lives
  in the sibling repo `NeSyCat.Web` and is a separate Vercel project.
- Hosted on Vercel; DNS authoritative there.
- Local dev: `npm run dev` on port 3456.
