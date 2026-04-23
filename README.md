# NeSyCat Semiotics

A web editor for category-theoretic **string diagrams**. Compose shapes,
wire their points, and round-trip the whole diagram as JSON — the visible
surface of the [NeSyCat](https://github.com/NeSyCat) toolkit for
neuro-symbolic research. Haskell codegen is on the roadmap.

Live at **[nesycat.com](https://nesycat.com)** — sign in with GitHub and
start drawing.

## What you can draw

| Kind       | Role in the diagram                                                  |
| ---------- | -------------------------------------------------------------------- |
| Empty      | Anonymous carrier — a labelled stub with a single side point.        |
| Point      | A named port on a shape's side (left / right / center, top / bottom).|
| Line       | A named wire from one point to one or more target points.            |
| Triangle   | Shape with a `total` apex point and a `center` column.               |
| Rhombus    | Shape with `total` + 3-slot columns on left/right (down/center/up).  |
| Circle     | Shape with `total` + 3-slot columns on left/right.                   |
| Rectangle  | Shape with `total` + 3-slot columns on left/right and top/bottom.    |

## Creating things

Everything is a gesture on the canvas. Double-click creates; modifier keys
pick the shape.

| Gesture                   | Creates       |
| ------------------------- | ------------- |
| `2×` double-click pane    | Empty         |
| `Alt` / `⌥` + `2×`        | Triangle      |
| `⇧` + `2×`                | Rhombus       |
| `␣` (hold space) + `2×`   | Circle        |
| `Ctrl` / `⌘` + `2×`       | Rectangle     |
| Click `+` on a node side  | Point         |
| Drag point → point        | Line          |

The Kinds menu in the upper-left shows the same cheat sheet and lets you
toggle visibility per kind.

## Editing

- **Select** — click a node, edge, or point. `⌘` / `Ctrl` + click adds to
  selection.
- **Move** — drag nodes; lines follow their endpoints.
- **Rename** — click a label to edit it inline.
- **Delete** — `Delete` / `Backspace` on any selection.
- **Undo / Redo** — `⌘Z` / `⌘⇧Z` (or `Ctrl` on non-Mac).
- **Edge style** — toggle between `Straight` and `Smooth` in the upper-left.
- **JSON** — the `JSON` button in the upper-right exports / imports the
  diagram. Diagrams are pure data (see
  [`diagrams/schema.nesycat.json`](./diagrams/schema.nesycat.json) for an
  example) — versionable in git, reviewable in a PR.

Autosave is on. Changes persist per-diagram to your account.

## Run locally

```bash
npm install
npm run dev -- -p 3456
```

Then open <http://localhost:3456>.

Authentication uses Supabase + GitHub OAuth. Copy `.env.example` to
`.env.local` and fill in the Supabase URL and anon key; point a GitHub
OAuth app at `http://localhost:3456/auth/callback` for local sign-in.

Database migrations live under [`supabase/`](./supabase) and
[`drizzle/`](./drizzle); schema generation is driven by
[`codegen/diagram-to-drizzle.ts`](./codegen/diagram-to-drizzle.ts).

## Stack

Next.js · React · TypeScript · [@xyflow/react](https://reactflow.dev) ·
Zustand · Supabase (Postgres + Auth) · Drizzle · Tailwind.
