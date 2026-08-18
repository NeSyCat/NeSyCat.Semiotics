# NeSyCat.Semiotics Database Schema — Narrative Source of Truth

This document is the **narrative source of truth** for the data model. It
doesn't stand alone — it's the third leg of a three-artifact pipeline, and
all three are kept in sync **by hand, together**:

```
_concept/02-diagram/schema.nesycat.json   conceptual SOT — the drawing, hand-edited
        │
        ▼  (codegen retired — see below)
prisma/contract.prisma                    DDL source — hand-authored, PSL
        │
        ▼  npm run p8:emit + npm run p8:update
Supabase Postgres                         applied by CI (preview + production)
```

`schema.nesycat.json` is the conceptual source of truth — what a table
*is*, drawn as a string diagram of rectangles, lines, and empties.
`prisma/contract.prisma` is now the DDL source — columns, foreign keys, RLS
policies, expressed in Prisma Schema Language — and, unlike the old
generated `schema.ts`, it is **hand-authored**: there is no codegen step
between the drawing and the contract in this round (the drawing's codegen,
`diagram-to-drizzle.ts`, is retired along with Drizzle; retargeting it to
emit PSL is a possible follow-up, not done here). This file, `SCHEMA.md`,
carries what the contract alone can't: the **why** — doctrine, the
reasoning behind every non-obvious column, policy, constraint, and the
invariants that only exist across several tables at once.

Admination's SCHEMA.md states its pairing rule as "the two are edited
together: a schema change without its SCHEMA.md update is an incomplete
change." That doctrine now applies directly rather than through a
generated intermediate: **a schema change touches `prisma/contract.prisma`
and this file — together, in the same change** (plus the drawing, when the
change needs a new structural pattern there too).

Hand-written SQL that the PSL contract cannot express at all — the
`SECURITY DEFINER` helper functions, the orphan-organization trigger —
lives in `prisma/sql/01-functions.sql` and `prisma/sql/02-guards.sql`,
each carrying its own header comment (superseding the old
`0001_org_rls_functions.sql` / `0003_org_membership_guards.sql` Drizzle
migrations, which now live under `supabase/migrations-archive/` for
history). This document cross-links to them by name rather than
duplicating their bodies.

---

## Preamble: conventions

These hold for every table in the diagram unless a table's own section
says otherwise:

- **Primary key**: every table has a surrogate `id uuid` primary key,
  `defaultRandom()` (`gen_random_uuid()` at the SQL level). No composite
  PKs in this corpus yet.
- **Audit stamps**: `created_at` / `updated_at`, both
  `timestamp with time zone`, `NOT NULL`, `.defaultNow()`. There is no
  `updated_at`-maintenance trigger yet (unlike Admination's
  `set_audit_updated()`) — application code is responsible for setting it
  on update. No `created_by` / `updated_by` columns exist in this schema;
  there is exactly one acting identity per write (the authenticated user)
  and RLS already pins every row to it, so a separate attribution column
  would be redundant.
- **Scalar type set**: the codegen supports exactly four non-PK scalar
  point types — `text`, `jsonb`, `tstz` (→ `timestamp with time zone`),
  `bool` (→ `boolean`, `.notNull().default(false)`). Anything else is a
  codegen error, not a silent fallback.
- **No FK to `auth.users` — the erasure doctrine.** Quoting Admination's
  SCHEMA.md, adapted: *an enforcing FK to `auth.users` would block
  deleting any login that ever touched anything (right-to-erasure)*. Every
  column that semantically points at a Supabase Auth user (`owned_by` in
  the old diagrams shape, `memberships.user_id` today) is a **plain
  `uuid`** column — never `.references()`. This is unconditional: it
  applies even where the column is `NOT NULL` and a `references()` call
  would type-check fine. The generator enforces it structurally (see
  `codegen/README.md`'s External FK rule) — it isn't a style guideline
  that could quietly regress.
- **Real FKs between `public` tables.** Every FK whose target is a
  `public` table rectangle (not `auth.users`) gets a real Postgres FK
  constraint: `uuid(col).notNull().references(() => target.id)`, no
  `onDelete` clause (→ Postgres default `NO ACTION`). Unlike the
  `auth.users` case, deleting an organization or a diagram is a domain
  operation this app fully controls, so there is no erasure concern
  blocking the constraint — and `NO ACTION` is the deliberate choice over
  `CASCADE`: it forces every delete path to be explicit about what happens
  to dependents rather than silently fanning out. See "Effective
  undeletability" under Organizations for what that produces in practice
  today.

## Auth reference

`auth.users` is Supabase GoTrue's identity table — logins, sessions,
tokens. It is drawn in the diagram as rectangle `R2`, `User (auth.users)`,
an **external** rectangle: the codegen recognizes any `total.name`
starting with `User` as external and never emits a `CREATE TABLE` for it
(see `codegen/README.md`). It exists in the drawing purely as an FK
*target* — today, the only wire still landing on it is
`memberships.user_id`.

`user_id` (on `memberships`) *is* `auth.uid()` — there is no separate
`members`/profile table in this schema (unlike Admination, which needed
one for pending invitations; invitations are out of scope here).
Display name and email are read straight from Supabase auth
`user_metadata` at the application layer, not stored redundantly in
`public`.

## Tables

### `diagrams` — organization-owned

A diagram belongs to exactly one organization via `organization_id uuid
NOT NULL REFERENCES organizations(id)` — **not** to a user. This is a
deliberate reversal of the schema's first cut (`owned_by → auth.users`,
now gone): a diagram is always drawn *inside* an organization, the way a
document lives in a shared workspace rather than in one person's account.
`R1`'s only incoming-FK wire (`organization_id`) targets `R3`
(Organization) in the drawing.

**RLS — `diagrams_member_all`, one policy, `FOR ALL`**: every member of
the owning organization — not just its owner — has full CRUD on that
organization's diagrams:

```ts
pgPolicy('diagrams_member_all', { for: 'all', to: authenticatedRole,
  using: sql`${t.organizationId} in (select public.my_member_organizations())`,
  withCheck: sql`${t.organizationId} in (select public.my_member_organizations())` })
```

Rationale (see "RLS doctrine" below for the general shape this widens
from): a collaborative diagram editor's baseline expectation is that
anyone in the workspace can edit what's in it. Owners get **no** extra
rights on diagrams specifically — ownership only matters for managing the
organization and its membership roster, not for what members can draw.

### `organizations`

Columns are unchanged from the schema's first cut: `id`, `name`,
`created_at`, `updated_at`. Nothing here is diagram-specific — this table
exists purely as the group that `memberships` and `diagrams` both point
into.

**Bootstrap naming.** An organization is never created bare through the
UI; it is always created *together with* its first owner membership, at
first login (`getMe()`, `lib/actions/organizations.ts`) or by the
diagrams-backfill migration (`0004`, see below) for pre-existing users.
Its name defaults to `` `${displayName}'s Organization` `` —
`displayName` preferring the user's `full_name`, then `name`, then the
local part of their email.

**Effective undeletability — an emergent invariant, documented rather
than "fixed."** With `NO ACTION` FKs everywhere an organization is
referenced, plus the last-owner trigger (`prevent_orphan_organization`,
below), an organization cannot be deleted through the API today:
`memberships.organization_id` and `diagrams.organization_id` both block
`DELETE FROM organizations` with an FK violation while any row still
references it, and `prevent_orphan_organization` independently blocks
removing the last owner *membership* while the organization still exists
— so there is no order of operations that clears the way. Admination has
the structurally identical deadlock (owner-org FK + its own orphan-org
trigger) and accepts it rather than special-casing a cascade; this schema
follows the same call. There is no delete-organization UI in this app,
so the gap is latent, not user-facing. One consequence worth naming:
the exemption in the `0003` trigger for an already-deleted organization
(`IF NOT FOUND THEN ... RETURN`) is now **unreachable but harmless** —
nothing can delete an organization out from under its memberships, so
that branch can never fire on production data. It stays in place because
removing it would only be cosmetic and the trigger is otherwise correct.

### `memberships`

The join between a user and an organization, carrying the role flag.

- `user_id uuid NOT NULL` — plain, no FK (erasure doctrine, above).
  `= auth.uid()` for the current session.
- `organization_id uuid NOT NULL REFERENCES organizations(id)` — real FK,
  `NO ACTION`.
- `is_owner boolean NOT NULL DEFAULT false` — the **only** role flag.
  There is no separate roles table and no `is_coach`-style
  domain-specific flag (Admination has one; this product doesn't need
  it). **Owner is entirely a property of the membership row**, not of the
  user or the organization: the same person can be an owner of one
  organization and a plain member of another, and "who owns this org"
  is answered by `SELECT ... WHERE organization_id = ? AND is_owner`, not
  by any column on `organizations` itself.
- One membership per (user, organization): `memberships_user_org_unique
  UNIQUE (user_id, organization_id)`, migration `0003`. Not expressible in
  the diagram/codegen (composite `UNIQUE` isn't a codegen v1 pattern), so
  it's hand-added there.
- **Last-owner invariant**: `prevent_orphan_organization()`
  (`BEFORE UPDATE OR DELETE` trigger, migration `0003`) refuses any
  update or delete that would leave an organization with zero
  `is_owner` rows. This is the authoritative guard — RLS restricts *who*
  can reach owner-row UPDATE/DELETE, but nothing in RLS stops an owner
  from demoting or removing themselves and orphaning the organization; the
  trigger is what actually prevents that outcome. See the migration's own
  header comment for the concurrency argument (`FOR UPDATE` lock on the
  organization row) and why it deliberately runs as the invoking role, not
  `SECURITY DEFINER`.
- **Bootstrap insert path**: a brand-new user has no membership row and
  cannot pass `memberships_insert_owner` (which requires already being an
  owner somewhere). `memberships_insert_bootstrap` is the escape hatch —
  it allows exactly one shape of insert: `user_id = auth.uid() AND
  is_owner = true AND organization_has_no_members(organization_id)`. Once
  that first row lands, the organization has a member and the bootstrap
  policy can never fire for it again.

## Functions & triggers

All three functions live in migration `0001_org_rls_functions.sql`
(hand-written — Drizzle has no declarative DSL for functions); the trigger
lives in `0003_org_membership_guards.sql`. The generated `pgPolicy()`
definitions in `schema.ts` reference the functions by name only; nothing
about their bodies is generated.

- **`my_member_organizations() RETURNS SETOF uuid`** — every organization
  the calling user (`auth.uid()`) has *any* membership in, owner or not.
  This is the "can I see it" predicate: every `*_select_member` and
  `*_member_all` policy across the schema is built on it.
- **`my_owner_organizations() RETURNS SETOF uuid`** — the subset of the
  above where `is_owner`. This is the "can I administer it" predicate:
  every `*_update_owner` / `*_delete_owner` / `*_insert_owner` policy is
  built on it.
- **`organization_has_no_members(org uuid) RETURNS boolean`** — used
  exclusively by `memberships_insert_bootstrap` (above) to gate the
  first-membership escape hatch.
- All three are `SECURITY DEFINER`, `STABLE`, `LANGUAGE plpgsql`,
  `SET search_path = ''` with fully-qualified (`public.`-prefixed) table
  references. `SECURITY DEFINER` is required here for the same reason
  Admination's helpers need it: RLS is enabled on `memberships`, and a
  policy on `memberships` (or on any table whose policy calls these
  functions) cannot safely read `memberships` inline without either
  recursion or the read failing under the caller's own restricted role —
  the functions read `memberships` as their **definer** (migration owner,
  which bypasses RLS) and hand back only a `SETOF uuid`, never a row, so
  no membership data leaks beyond "which org ids." `STABLE` (not
  `VOLATILE`) tells the planner these can be called once per statement,
  not once per row.
- **`prevent_orphan_organization() RETURNS trigger`** — see "Last-owner
  invariant" under `memberships`, above, for what it guarantees.
  Deliberately **not** `SECURITY DEFINER`: it runs as the invoking role,
  so its internal `SELECT`s are themselves subject to RLS — correct today
  because only an organization's own owners can ever reach an
  owner-row `UPDATE`/`DELETE` in the first place (RLS already restricts
  the trigger's caller before the trigger body runs), and those owners
  pass every policy the trigger's queries need
  (`memberships_select_member`; the row lock on `organizations` via
  `my_owner_organizations()`). If a future policy ever narrows what an
  owner may `SELECT` on either table, this must become `SECURITY
  DEFINER` at the same time, or the trigger's own read could start
  failing for the very users it's supposed to protect.

## RLS doctrine

Every role check ultimately traces back to `memberships` — there is no
authorization data anywhere else. Two shapes recur, and every new
org-scoped table should reach for one of them rather than invent a third:

- **`owner_all` + `member_read`** (`organizations`'s own shape, and the
  default to imitate for a new table): owners get full CRUD
  (`*_update_owner`, `*_delete_owner`, sometimes `*_insert_owner`),
  everyone else who's a member can only read (`*_select_member`). This is
  the conservative default — reach for it first.
- **`member_all`** (`diagrams`'s shape — the documented **widened**
  case): every member, not just owners, gets full CRUD, expressed as one
  `FOR ALL` policy instead of four narrower ones. This is only correct
  for resources where collaborative write access genuinely is the
  product's intent, the way Admination widens specific tables (e.g. its
  `teilnehmende_coach_*` policies) beyond its own owner/member default for
  the same reason — deliberately, and called out by name each time it
  happens, never as an accidental default. `diagrams` is currently the
  only instance. The codegen calls this shape a **group-scoped table**
  (`codegen/README.md`): any non-membership, non-group table with exactly
  one FK to a group table gets it automatically, with no hardcoded table
  names — so the *next* table drawn with a single FK into `organizations`
  gets `member_all` for free, and the generator refuses to guess (`die()`)
  if a table's FK shape to a group table is ambiguous instead.

Membership tables themselves (`memberships`) get a third, more granular
set (`*_select_self` / `*_select_member` / `*_insert_owner` /
`*_insert_bootstrap` / `*_update_owner` / `*_delete_owner`) — documented
in full in `codegen/README.md`'s "Membership pattern" section, since it's
generator-emitted, not something a future table author writes by hand.
