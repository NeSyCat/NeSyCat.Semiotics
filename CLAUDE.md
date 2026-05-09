# NeSyCat.Semiotics — Claude Code instructions

## Scope

This repo is **only** the Semiotics editor (the in-browser string-diagram tool),
deployed at `https://semiotics.nesycat.com`. The umbrella marketing/info site
for the NeSyCat project as a whole lives in the sibling repo `NeSyCat.Web`,
deployed at `https://nesycat.com`. Don't reintroduce marketing copy here — it
belongs on `nesycat.com`.

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
- **`_tests/`** — manual / file (Vitest) / e2e / main / staging buckets. Runners not yet wired.

The underscore prefix sorts these meta folders to the top of file-tree listings.

## Schema flow

```
_concept/02-diagram/schema.nesycat.json   (you edit this)
        │
        ▼  npm run db:diagram
_concept/03-orm-schema/schema.ts          (generated — DO NOT EDIT)
        │
        ▼  npm run db:generate            (drizzle-kit generate)
_concept/03-orm-schema/migrations/*.sql
        │
        ▼  git push                       (Supabase auto-applies via branching)
Supabase Postgres
```

The pipeline is linear: there is **no** manual `drizzle-kit migrate` step.
Drizzle's job ends at producing SQL files. Supabase's GitHub integration
applies those files automatically — to a per-PR preview branch on PR open,
to the `staging` persistent branch on merge, and to production on promotion
to `main`. See "Why there's a `supabase/` folder at root" below.

`lib/db/index.ts` (drizzle client + `withRLS()`) and `lib/supabase/*` (auth
SDK clients + middleware) are the **runtime** glue — they consume what
`_concept/` defines. Don't move them; don't conflate them with concept.

## Why there's a `supabase/` folder at root

Supabase's GitHub integration auto-applies migrations from
`<workdir>/supabase/migrations/` and reads config from
`<workdir>/supabase/config.toml`. Its working dir is `.` (repo root), so it
looks at the root. Our canonical locations are deeper, per the `_concept/`
taxonomy:

- migrations: `_concept/03-orm-schema/migrations/` (Drizzle's `out:` target)
- config:     `_concept/04-data-schema/config.toml`

`supabase/` at root is a real directory containing two symlinks bridging
both. Drizzle remains the single source of truth for migrations; Supabase
reads through the bridge. Don't put real files in `supabase/` — only
symlinks back into `_concept/`.

## Branch + PR strategy

- `staging` is the integration branch. PRs go to `staging`, then promoted to `main`.
- Don't push directly to `main` or `staging`.
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
  via `npm run db:…` so cwd stays at repo root and `.env.local` resolves. The
  scripts intentionally don't include a `db:migrate` — Supabase applies
  migrations on push, not Drizzle.

## Deployment

- Production: `https://semiotics.nesycat.com`
- The umbrella site `https://nesycat.com` (and `https://www.nesycat.com`) lives
  in the sibling repo `NeSyCat.Web` and is a separate Vercel project.
- Hosted on Vercel; DNS authoritative there.
- Local dev: `npm run dev` on port 3456.
