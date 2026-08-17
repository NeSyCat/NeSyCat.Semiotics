# codegen/diagram-to-drizzle

Generic generator that turns a NeSyCat string-diagram (JSON) into a Drizzle `schema.ts`.

```
_concept/02-diagram/schema.nesycat.json   (conceptual SOT — drawn in NeSyCat editor)
        │
        ▼  _concept/03-orm-schema/codegen/diagram-to-drizzle.ts
_concept/03-orm-schema/schema.ts          (generator output — DO NOT EDIT)
        │
        ▼  drizzle-kit generate
_concept/03-orm-schema/migrations/*.sql
        │
        ▼  drizzle-kit migrate (DIRECT_URL)
Supabase Postgres
```

Run: `npm run db:diagram`.

`_concept/03-orm-schema/schema.ts` carries a DO-NOT-EDIT banner. Any change flows through the diagram.

## Conventions the generator reads

A diagram is a set of `rectangles`, `lines`, and `empties`. The generator walks it with the following rules. Anything outside these rules is an error (the generator exits 1 with a message pointing at the offending id).

### Tables

- Every rectangle is either a **table** or an **external** reference.
- External rectangles are those whose `total.name` starts with `User` (e.g. `User (auth.users)`). They are **not** emitted — they only exist as FK targets for owner columns.
- Table name = `pluralize(snake(total.name))` (e.g. `Diagram` → `diagrams`).
- TS export name = `camel(tableName)` (e.g. `diagrams`).

### Primary key

- `rectangle.points.center.center` must be `{ name: 'uuid' }`.
- Emitted as `id: uuid('id').primaryKey().defaultRandom()`.
- Any other PK type is unsupported in v1.

### Columns — from slots

The generator enumerates every non-PK slot on every face of the rectangle:

- `left.center[]`, `right.center[]`
- `left.up`, `left.down`, `right.up`, `right.down`
- `up[]`, `down[]`
- `center.up`, `center.down`

For each slot, it looks up the outgoing line whose `source` references that slot and classifies the target:

#### Scalar column — target is an empty

- **Column name**: part of `line.id` after the first `_`, snake-cased. (`Diagram_title` → `title`, `Diagram_created_at` → `created_at`.) Line ids without `_` are used as-is.
- **Column type** from the slot's point `name`:
  - `text` → `text(col).notNull()`
  - `jsonb` → `jsonb(col).notNull()`
  - `tstz` → `timestamp(col, { withTimezone: true }).notNull()`. If column name ∈ `{created_at, updated_at}`, `.defaultNow()` is appended.
  - `bool` → `boolean(col).notNull().default(false)`

#### Foreign key column — target is another rectangle's `center.center`

- **Direction alone** determines FK-ness. A line sourced anywhere on rectangle A whose target is rectangle B's `center.center` is an FK on A referencing B. Which face (left/right/up/down/center.up/center.down) the source slot sits on is irrelevant.
- The target point must be `{ side: 'center', slot: 'center' }`. Any other target is an error.
- The source slot's `name` must be `uuid`. Anything else is an error.
- **Column name** = `snake(line.id)` (e.g. `organization_id` → `organization_id`, `user_id` → `user_id`).
- **Internal FK** (target is another table rectangle): emitted as `uuid(col).notNull().references(() => <targetExport>.id)` — a real Postgres FK constraint, no `onDelete` (NO ACTION). The arrow is lazy, so it's safe for the target table to be declared later in the file.
- **External FK** (target is a `User*`/`auth.users` rectangle): emitted as plain `uuid(col).notNull()` — **no** `.references()`, ever. An enforcing FK to `auth.users` would block deleting a login (right-to-erasure doctrine — see `_concept/03-orm-schema/SCHEMA.md`). This rule is unconditional: it applies to every external FK, including a membership table's user FK.
- Nullable FKs TBD.

### RLS — owner-only policies

If a table has exactly one FK whose target is an **external** rectangle that pluralizes to `users`, that FK is marked as the **owner column**. The generator emits four policies tied to `authenticatedRole`:

```ts
pgPolicy('<table>_select_own', { for: 'select', to: authenticatedRole, using: sql`${t.owner} = ${authUid}` })
pgPolicy('<table>_insert_own', { for: 'insert', to: authenticatedRole, withCheck: sql`${t.owner} = ${authUid}` })
pgPolicy('<table>_update_own', { for: 'update', to: authenticatedRole, using: …, withCheck: … })
pgPolicy('<table>_delete_own', { for: 'delete', to: authenticatedRole, using: … })
```

Declaring policies in the Drizzle table causes `drizzle-kit generate` to emit `ENABLE ROW LEVEL SECURITY` for the table.

Tables with no owner FK get no policies (and, with RLS disabled at the table level, remain unreachable from the `authenticated` role by default — Supabase project policy).

### RLS — the membership pattern

A table is a **membership table** when it has *exactly two* FK columns — one targeting an **external** rectangle (a `User*` FK) and one targeting another **table** rectangle — and a `bool` column named `is_owner`. The internal FK's target is the **group table**. This is purely structural: nothing is hardcoded to specific table names, so any diagram shape matching it is treated as a membership.

Membership tables are **exempt** from the owner-only template above: their external (user) FK does not get `*_own` policies. Instead:

- **Membership table `M`** (user FK `u`, group FK `g`, group table `G`, group's singular name `S`) gets:
  ```ts
  pgPolicy('<M>_select_self',      { for: 'select', to: authenticatedRole, using: sql`${t.u} = ${authUid}` })
  pgPolicy('<M>_select_member',    { for: 'select', to: authenticatedRole, using: sql`${t.g} in (select public.my_member_<G>())` })
  pgPolicy('<M>_insert_owner',     { for: 'insert', to: authenticatedRole, withCheck: sql`${t.g} in (select public.my_owner_<G>())` })
  pgPolicy('<M>_insert_bootstrap', { for: 'insert', to: authenticatedRole, withCheck: sql`${t.u} = ${authUid} and ${t.isOwner} = true and public.<S>_has_no_members(${t.g})` })
  pgPolicy('<M>_update_owner',     { for: 'update', to: authenticatedRole, using: sql`${t.g} in (select public.my_owner_<G>())`, withCheck: sql`${t.g} in (select public.my_owner_<G>())` })
  pgPolicy('<M>_delete_owner',     { for: 'delete', to: authenticatedRole, using: sql`${t.g} in (select public.my_owner_<G>())` })
  ```
- **Group table `G`** gets:
  ```ts
  pgPolicy('<G>_select_member', { for: 'select', to: authenticatedRole, using: sql`${t.id} in (select public.my_member_<G>())` })
  pgPolicy('<G>_insert_auth',   { for: 'insert', to: authenticatedRole, withCheck: sql`true` })
  pgPolicy('<G>_update_owner',  { for: 'update', to: authenticatedRole, using: sql`${t.id} in (select public.my_owner_<G>())`, withCheck: sql`${t.id} in (select public.my_owner_<G>())` })
  pgPolicy('<G>_delete_owner',  { for: 'delete', to: authenticatedRole, using: sql`${t.id} in (select public.my_owner_<G>())` })
  ```

The `my_member_<G>()`, `my_owner_<G>()`, and `<S>_has_no_members(id)` helper functions are **not** emitted by the generator — they're hand-written `SECURITY DEFINER` SQL in a custom migration (see `_concept/03-orm-schema/migrations/0001_org_rls_functions.sql` for the `organizations`/`memberships` instance). The generator only references them by name in the policies above; it dies if a membership-shaped table (one external FK + one internal FK) is missing the `is_owner` column, since it can't tell whether that was intentional.

### RLS — the group-scoped pattern

A **group table** is whatever a membership table's internal FK targets (`organizations`, above). Any other table — one that is **neither** a membership table **nor** a group table itself — with **exactly one** FK column, whose target *is* a group table, is a **group-scoped table**. It gets one `FOR ALL` policy giving every member of the owning group full CRUD:

```ts
pgPolicy('<T>_member_all', { for: 'all', to: authenticatedRole,
  using: sql`${t.fk} in (select public.my_member_<G>())`,
  withCheck: sql`${t.fk} in (select public.my_member_<G>())` })
```

(`diagrams` is the instance: its `organization_id` FK targets `organizations`, a group table, so it gets `diagrams_member_all` instead of the owner-only template.) This is the deliberately **widened** default — a collaborative resource where every member of the owning org may write, not just its creator. The owner-only template above stays the shape to reach for when write access should instead be restricted to the org's owners.

A non-membership, non-group table with an FK to a group table that *doesn't* match this shape (more than one FK column) is ambiguous — the generator `die()`s rather than guess which policy set was intended.

### Safety exits

The generator fails loudly on:

- unknown scalar point type
- rectangle with no `total.name`
- table rectangle with missing or non-`uuid` `center.center`
- slot with no outgoing line
- target node that is neither an empty nor another rectangle's `center.center`
- FK line whose target is not `center.center`
- FK line whose source is not `uuid`
- duplicate column names on one table
- multiple owner FKs on one table
- duplicate line source keys
- a table with one external FK + one internal FK (membership shape) but no `bool` column named `is_owner`
- a non-membership, non-group table with an FK to a group table that isn't its only FK column (ambiguous group-scoped shape)

## Adding a new table

1. Open the diagram in the NeSyCat editor.
2. Add a rectangle. Fill `total.name`, set `center.center = { name: 'uuid' }`.
3. Add leaf empties for each scalar column with the right `left.name` (`text` / `jsonb` / `tstz`).
4. For each scalar: draw a line from a slot on the rectangle to the empty. Line id = `<TotalName>_<column_name>` (e.g. `Module_title`).
5. For each FK: draw a line from a slot on the rectangle to the target rectangle's `center.center`. Line id = column name (e.g. `owned_by`, `module_id`).
6. Save the diagram JSON to `_concept/02-diagram/schema.nesycat.json`.
7. `npm run db:diagram && npm run db:generate && npm run db:migrate`.

Never hand-edit `_concept/03-orm-schema/schema.ts`. If the generator can't express what you need, extend the generator, not the TS output.
