---
name: drawing-semiotic-diagrams
description: >-
  Conventions for drawing NeSyCat Semiotics diagrams via the nesycat-semiotics
  MCP — turning Prisma Next / database contracts into sysmer diagrams. Use when
  creating, editing, or laying out Semiotics diagrams, or mapping models, fields,
  relations, embedded types, or discriminated unions onto shapes.
---

# Drawing Semiotic Diagrams

Guidance for drawing **NeSyCat Semiotics** diagrams through the `nesycat-semiotics` MCP server.
A diagram (a "sysmer") is a knowledge object: it encodes a schema — a Prisma Next contract, a
database, a type system — as geometry. Follow these conventions so every drawing is consistent,
grid-clean, and reads the same as one drawn by hand in the editor.

## The model

A diagram is `{ schemaVersion: 1, forms: Form[], points: Record<id, Point>, lines: Line[] }`.

- **Form** — a "big shape": `square | circle | triangle | rhombus | empty`. Has a `name`,
  `position {x,y}` (top-left, flow px), optional `rotation` (deg, clockwise), `scale`, and
  `edges: Record<edgeKey, pointId[]>` (each edge holds an ordered list of the points on it).
- **Point** — a labelled port sitting on ONE edge of a form (`formId` + `edgeKey`). Leaf; a
  point's own `shape` defaults to `empty` (no glyph — just a labelled attachment).
- **Line** — a named wire (hyperedge): one `source` point → one or more `targets`.

**Edge keys per shape** (use exactly these — an invalid key is rejected):

| shape | edge keys |
|---|---|
| square | `top`, `right`, `bottom`, `left` |
| circle | `up`, `right`, `down`, `left` |
| triangle | `a` (top slant), `b` (bottom slant), `c` (base side), `peak` (apex, holds ≤1 point) |
| rhombus | `top-right`, `bottom-right`, `bottom-left`, `top-left` |
| empty | `self` |

## The mapping — schema → shapes

When drawing a Prisma Next contract (or any relational/document schema):

| Schema concept | Shape | Notes |
|---|---|---|
| **model** (a collection/table) | **square** | Its `name` is the model name. |
| **field** | **point** on the square's edge | The point's `name` is the field name. Group related fields on one edge. |
| **relation** | **line** | See direction rule below. |
| **embedded / composite type** (e.g. a Prisma `type`) | **circle** | Its fields are points on the circle; a line from the owning model's field connects to it. |
| **discriminated union** (`@@discriminator` + `@@base` variants) | **triangle** | See the triangle rule below. |

### Relation direction rule

A relation line is **sourced on the side that declares/owns the relation** (the model holding the
foreign key / the `@relation(fields: …)`), with the **target** on the referenced model. Name the
line **exactly** the relation field's name — nothing composite.

> Example: `model Post { author User @relation(fields: [authorId], references: [id]) }` with the
> back-relation `model User { posts Post[] }`. The owner is **Post** (it has `authorId`). So the
> line is **source = Post's `author` point → target = User**, named **`author`** (not
> "posts/author", not sourced on User).

### Discriminated-union triangle

A `@@discriminator` model (e.g. `Post`) split into variant models (`Article`, `Tutorial` via
`@@base(Post, "…")`) is drawn as a **triangle** with `rotation: 270` so the **apex points up**:

- The base model connects to the triangle's **`peak`** (the apex, now at the top).
- The variant models branch from the triangle's **`c`** edge (the base, now the bottom horizontal
  edge) — put one point per variant on `c`. Each variant model is a square below, connected by a
  line named after its discriminator value (`article`, `tutorial`).
- Variant models carry only their *own* extra fields; the shared fields stay on the base model.

## Conventions (always)

1. **No colours without meaning.** Do NOT set `color` decoratively. Leave forms uncoloured by
   default. Only use colour when it encodes something real (and say what).
2. **Labels are `\mathtt{…}`.** Every `name` (forms and points) renders through KaTeX. Wrap text
   in `\mathtt{…}` so it reads as clean typewriter type, e.g. `name: "\\mathtt{User}"`,
   `"\\mathtt{authorId}"`. Bare text renders as math-italic — avoid it. Use real LaTeX for
   anything mathematical.
3. **Snap to the grid, always.** The grid pitch is **50 px** (`GRID_SIZE`), forms are **200 px**
   (`BASE_SIZE`). Place every form on the grid — never at arbitrary coordinates. Snapping is by
   **centre**: put form centres on grid intersections (multiples of 50; space models cleanly, e.g.
   200 or 400 apart) and set `position = centre − 100`. When building data by hand, run each
   position through the editor's `snapCenterPosition(form, position)` (from
   `components/editor/domain/grid.ts`) to guarantee alignment.
4. **Connection-only points are unnamed.** A point that exists solely to anchor a line (e.g. the
   apex input, a variant's attach point) gets no `name`. Reserve labels for real fields.

## Drawing with the MCP

Tools: `list_organizations`, `list_diagrams`, `get_diagram`, `create_diagram`, `update_diagram`,
`rename_diagram`, `delete_diagram` (needs `confirm: true`), `duplicate_diagram`; drawing ops
`add_form`, `add_point`, `add_line`, `remove_element`, `set_element_name`, `move_form`;
`validate_diagram`, `import_diagram`, `export_diagram` (`json` | `tikz` | `html`).

Two ways to draw:

- **Incremental** — `add_form` → `add_point` (reject invalid edge keys) → `add_line`. Good for
  edits.
- **Whole diagram** — build the full `{schemaVersion, forms, points, lines}` and `create_diagram`
  / `update_diagram`. Every write is validated: dangling point/form/line references are refused.

Before any write, make sure: no gratuitous colour, all labels `\mathtt{…}`, all positions
grid-snapped, relation lines sourced on the owning side, discriminated unions drawn apex-up.

## Worked example — the Prisma Next sample contract

`User` (+embedded `Address`) and `Post` discriminated by `kind` into `Article` / `Tutorial`:

- Squares: `User`, `Post`, `Article`, `Tutorial`. Circle: `Address`. Triangle (rot 270): `kind`.
- Fields as points: `User` → id, name, email, bio, posts, address; `Post` → author, id, title,
  content, kind, createdAt; `Address` → street, city, zip, country; `Article` → summary;
  `Tutorial` → difficulty, duration.
- Lines: `author` (Post → User, owner = Post); `address` (User → Address, owner = User);
  the discriminator wire (Post → `kind` peak, unnamed); `article` / `tutorial` (each variant →
  the `kind` base edge `c`).
- No colours. All labels `\mathtt{…}`. All forms grid-snapped, centres 200/400 apart.
