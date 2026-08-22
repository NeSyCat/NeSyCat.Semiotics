# mcp — NeSyCat Semiotics

A local, stdio [MCP](https://modelcontextprotocol.io) server giving an AI agent full CRUD + drawing
control over Semiotics diagrams — create/edit/move/delete forms, points, and lines, import/export,
without going through the editor UI.

## The auth model — authenticated AS the signed-in user, RLS stays on

Unlike the sibling `Admination.08-Management/mcp` server this one is modeled after, this server
does **not** bypass Row Level Security. There is no service-role key, no `DATABASE_URL`/`DIRECT_URL`,
no direct Postgres connection anywhere in this package — every query goes through
`@supabase/supabase-js` using only the **anon key**, carrying the **signed-in user's own session**
(`npm run login`, below). Postgres RLS then does exactly what it does for the web app itself:
`diagrams`/`organizations` queries are automatically scoped to the organizations that user is a
member of (`prisma/contract.prisma`'s `my_member_organizations()` policies). This server can never
see another user's data, and never needs to — the same guarantee the app's own RLS gives every
other client.

The session is saved to `mcp/.session.json` (gitignored) via a small file-backed storage adapter
(`src/supabase/session-storage.ts`) passed to `createClient`'s `auth.storage` option, standing in
for the browser `localStorage` supabase-js defaults to — there is no browser runtime here, just
separate CLI invocations (`login`, `whoami`, `logout`, `start`) that all need to see the same saved
session.

## Setup

```bash
cd mcp
cp .env.example .env
# Fill in SUPABASE_URL and SUPABASE_ANON_KEY — copy NEXT_PUBLIC_SUPABASE_URL and
# NEXT_PUBLIC_SUPABASE_ANON_KEY from ../.env.local (the SAME public values the app itself uses;
# never the service-role key, never DATABASE_URL/DIRECT_URL).
npm install
```

**Before logging in**, add `http://localhost:8976/callback` (or your `SEMIOTICS_LOGIN_PORT`, if
you changed it) to **Supabase → Authentication → URL Configuration → Redirect URLs** — the OAuth
callback below is rejected by Supabase if that loopback URL isn't allow-listed, even though
`signInWithOAuth` itself will still return a URL.

```bash
npm run login    # opens a browser, sign in with GitHub, then close the tab
npm run whoami    # sanity check — should print your email/id
```

`npm run login` starts a tiny local HTTP server on `http://localhost:8976/callback` (configurable
via `SEMIOTICS_LOGIN_PORT`), opens Supabase's GitHub OAuth URL in your default browser
(`open`/`xdg-open`/`start` — no extra dependency), captures the `?code=` GitHub/Supabase redirect
back to that loopback server, exchanges it for a session (`exchangeCodeForSession`), and saves it.
`npm run logout` signs out and deletes `mcp/.session.json`.

## Registering with Claude Code

From the repo root:

```bash
claude mcp add nesycat-semiotics -- npx tsx /absolute/path/to/NeSyCat.Semiotics/mcp/src/index.ts
```

(Use an absolute path — the server resolves `mcp/.env`/`mcp/.session.json` relative to its own
file location, not the caller's cwd, but the MCP host still needs an absolute path to find
`src/index.ts` in the first place.)

## Tools

| Area | Tools |
|---|---|
| Auth | `whoami` |
| Organizations | `list_organizations` |
| Diagrams | `list_diagrams`, `get_diagram`, `create_diagram`, `update_diagram`, `rename_diagram`, `delete_diagram` (requires `confirm:true`), `duplicate_diagram` |
| Drawing | `add_form`, `add_point`, `add_line`, `remove_element`, `set_element_name`, `move_form` |
| Validate | `validate_diagram` |
| Import/Export | `import_diagram`, `export_diagram` (`json`/`tikz`/`html`) |

Every write tool runs the diagram data through `restoreDiagram` (the editor's own load-boundary
normalizer — see below) before it ever reaches the database, so an MCP-authored
diagram is validated exactly the same way a diagram loaded in the browser editor is.

`create_diagram`/`import_diagram`'s `organizationId` is optional: it falls back to
`SEMIOTICS_DEFAULT_ORG` (`.env`), then to "the user's only organization" if that's unambiguous;
otherwise call `list_organizations` first and pass one explicitly — the same pattern
`Admination.08-Management/mcp`'s `create_area` uses for its own organization-resolution.

## Shared editor logic — imported live, never copied

Every tool here is backed by the editor's own pure, DOM-free domain modules, imported **directly**
from `../components/editor/` (single source of truth — no copies):

- `domain/{types,forms,mutations,ids,color}.ts`, `persist/{io,share}.ts`, `ir/geometry-ir.ts`,
  `export/{tikz,html}.ts`.

So an MCP edit uses the SAME `restoreDiagram` normalizer, the SAME `addForm`/`addPoint`/`addLine`
mutators (id-generation included), and the SAME TikZ/HTML export pass the browser editor uses — and
can never drift from it.

Notes:
- This server is a sub-package of the app: `forms.ts` imports `Position` from `@xyflow/react`, which
  resolves from the app's own `node_modules`. Run `npm install` at the repo root once so the app's
  deps are present.
- The relative import (`../../../components/editor/…`) works under `tsx` (runtime) and `tsc`
  (`moduleResolution: bundler`, `.js` specifiers). It resolves through this package's ESM graph
  without issue; no `"type": "module"` change to the app is needed.
- Out of scope (not imported): `components/editor/domain/{grid,handles}.ts` and `ui/`/`state/` —
  nothing in this server's tool set touches canvas grid-snapping, hover/drag handles, or React state.

## Development

```bash
npm run build   # tsc --noEmit
npm test        # vitest — pure unit tests only, no network/Supabase calls
```

`test/` covers the file-storage adapter (round-trip, `removeItem`, a corrupt file degrading to
empty rather than throwing), the drawing ops' pure core (`src/diagram/ops.ts` — add form → add
points on valid edges → add line producing a diagram that survives `restoreDiagram`; an invalid
edge key rejected with the shape's valid list; unknown ids rejected), `validate_diagram` flagging a
dangling point→form reference, line→point reference, and form-edge→point reference, and
`duplicate_diagram`'s pure data-copy + title-defaulting logic. None of it touches Supabase — the
tool handlers in `src/tools/` are thin wrappers around this pure core (`src/diagram/ops.ts`) plus
the actual `select`/`insert`/`update`/`delete` calls, so the core is testable without a live
session or database.
