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

`prisma/contract.prisma` is the DDL source of truth — tables, columns, RLS,
policies — replacing the old Drizzle `schema.ts`. Its policies are adopted
from production **byte-for-byte** (`PN_EXACT_NAME_BODY_COMPARISON`); don't
hand-tune a policy string without checking the drift consequences.

```
prisma/contract.prisma                    (you edit this)
        │
        ▼  npm run p8:emit                (writes contract.json + contract.d.ts)
        ▼  npm run p8:update:dry          (preview the delta against a live DB)
        │
        ▼  PR opened                      preview workflow bootstraps an empty
        │                                  Supabase branch DB from the contract
        ▼  merge to main                  production-db.yml runs `db update`
        │                                  against production
Supabase Postgres
```

`prisma db update` (not the migration-graph `migrate`/`plan` commands, which
are broken post-adoption on this Prisma 8 RC) is the applier both locally
(`npm run p8:update`) and in CI. `prisma/sql/` is a lane the contract cannot
see: functions and triggers aren't PSL concepts, so the RLS helper functions
and the orphan-organization guard trigger live there as hand-written,
idempotent SQL applied via `psql` — `db verify --strict` will never flag them
missing. See `prisma/README.md` for the exact bootstrap/deploy order.

The concept drawing (`_concept/02-diagram/schema.nesycat.json`) and
`_concept/03-orm-schema/SCHEMA.md` remain the conceptual/narrative docs;
their codegen (`diagram-to-drizzle.ts`) is retired along with Drizzle, so
they no longer feed the DDL automatically — a future option is retargeting
that codegen to emit PSL instead of `schema.ts`, not done this round.

`lib/db/index.ts` (Prisma 8 client + `withRLS()`) and `lib/supabase/*` (auth
SDK clients + middleware) are the **runtime** glue — they consume what
`prisma/contract.prisma` defines. Don't move them; don't conflate them with
concept.

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
- **Prisma 8 ("Prisma Next")**: `prisma.config.ts` lives at `prisma/prisma.config.ts`.
  The `p8:*` scripts in `package.json` pass `--config prisma/prisma.config.ts` —
  always invoke them via `npm run p8:…` so cwd stays at repo root and
  `.env.local` resolves. `contract.json`/`contract.d.ts` are generated by
  `p8:emit` and committed — the runtime (`lib/db/index.ts`) imports
  `contract.json` directly; never hand-edit either generated file.
  `prisma/contract.d.ts` is a `.d.ts` with no sibling `.ts` — TypeScript
  resolves an import specifier of `./contract.d` (not `./contract`) to it, an
  intentional quirk matched by every import site.
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

## Invitation emails (optional)

`inviteMember` (`lib/actions/organizations.ts`) sends a notification email via
Brevo (`lib/email.ts`, `@getbrevo/brevo`) after writing the invitations row.
The message carries no token or link back to a specific invite — acceptance
already works by matching the invitee's verified sign-in email against the
invitations row (see `getMe`), so the email is purely "you've been invited,
sign in with this address."

Three env vars, all optional:

- `BREVO_API_KEY` — Brevo API key.
- `INVITE_EMAIL_FROM` — verified sender address.
- `INVITE_EMAIL_FROM_NAME` — sender display name; defaults to "NeSyCat Semiotics".

Missing `BREVO_API_KEY` or `INVITE_EMAIL_FROM` (the default state locally and
in PR previews — neither is set anywhere but production) degrades gracefully:
the invitations row still gets written and `inviteMember` still reports
success, just with a `warning` the UI surfaces inline ("Invitation created,
but the email could not be sent…") instead of silently pretending the email
went out. Same degrade path if Brevo itself errors. Sending must never throw
out of `inviteMember` — see `lib/email.ts`'s header comment.

## Deployment

- Production: `https://semiotics.nesycat.org`
- The umbrella site `https://nesycat.org` (and `https://www.nesycat.org`) lives
  in the sibling repo `NeSyCat.Web` and is a separate Vercel project.
- Hosted on Vercel; DNS authoritative there.
- Local dev: `npm run dev` on port 3456.
