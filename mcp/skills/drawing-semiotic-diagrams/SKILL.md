---
name: drawing-semiotic-diagrams
description: >-
  Conventions for drawing NeSyCat Semiotics diagrams via the nesycat-semiotics
  MCP — turning Prisma Next / database contracts into sysmer diagrams. Use when
  creating, editing, or laying out Semiotics diagrams, or mapping models, fields,
  types, relations, embedded/composite types, or discriminated unions onto shapes.
---

# Drawing Semiotic Diagrams

Guidance for drawing **NeSyCat Semiotics** diagrams through the `nesycat-semiotics` MCP server.
A diagram (a "sysmer") encodes a schema — a Prisma Next contract, a database, a type system — as
geometry. Follow these conventions so every drawing is consistent, grid-clean, and reads the same
as one drawn by hand in the editor.

## The model

A diagram is `{ schemaVersion: 1, forms: Form[], points: Record<id, Point>, lines: Line[] }`.

- **Form** — a "big shape": `square | circle | triangle | rhombus | empty`. Has a `name`,
  `position {x,y}` (top-left, flow px), optional `rotation` (deg, clockwise), `scale`, and
  `edges: Record<edgeKey, pointId[]>`.
- **Point** — a port on ONE edge of a form (`formId` + `edgeKey`). Its own `shape` defaults to
  `empty` (no glyph). **A point is labelled with a TYPE.**
- **Line** — a wire from one `source` point to `targets`. **A wire is labelled with a NAME.**
  A fork is **several separate wires** from the same source point, each independently named — never
  one wire with many targets (that would force one shared name across branches).

## The core encoding — points are TYPES, wires are NAMES

This is the rule that everything else follows:

- **A point = a type** (its `name` is a type: `\mathtt{String}`, `\mathtt{ObjectID}`, a model name).
- **A wire = a named thing** connecting typed points (its `name` is the field/relation name).

### Schema → shapes

| Schema concept | Drawn as |
|---|---|
| **model** (collection/table) | a **square** box, named with the model name |
| **type node** (`String`, `ObjectID`, …) | an **`empty`** form, named with the type |
| **scalar field** `f: T` | a **wire** named `f` from a typed port on the model (labelled `T`) to a type-node (labelled `T`) |
| **relation** | a **wire** named the relation field — see direction rule |
| **embedded / composite type** (a Prisma `type`) | a **fan** — see below |
| **discriminated union** (`@@discriminator` + `@@base` variants) | a **triangle**, apex up — see below |

### Relation direction rule

A relation wire is **sourced on the side that declares/owns the relation** (the model holding the
foreign key / `@relation(fields: …)`), targeting the referenced model. Name the wire **exactly**
the relation field's name.

> `model Post { author User @relation(fields: [authorId], references: [id]) }` with
> `model User { posts Post[] }`: the owner is **Post**. The wire is **Post's `author` port → User**,
> named **`author`** — not "posts/author", not sourced on User.

### Composite / embedded types are a FAN (not their own shape)

A composite type (e.g. `Address`) is **not** a special shape — it's a **fan of wires**. The owning
model's field wire (`address`) runs to a hub point labelled with the type name (`Address`); from
that hub, **one separate wire per sub-field** (`street`, `city`, `zip`, `country`) fans out to its
own type-node (`String`). Each fan wire is an independent, differently-named wire.

```
User --address--> (Address hub) --street--> String
                              \--city----> String
                              \--zip-----> String
                              \--country-> String
```

### Discriminated unions are a triangle (apex up)

A `@@discriminator` model (e.g. `Post`) split into `@@base` variants (`Article`, `Tutorial`) is a
**triangle** with `rotation: 270` so the apex points up: the base model connects to the triangle's
`peak` (top); each variant model branches from the triangle's `c` edge (the bottom), one wire per
variant named after its discriminator value. Variant models carry only their *own* extra fields.
*(Composite types fan; unions use the triangle — confirm this split if in doubt.)*

## Conventions (always)

1. **No colours without meaning.** Never set `color` decoratively — leave forms uncoloured. Colour
   only when it encodes something real (and say what).
2. **Labels are `\mathtt{…}`.** Every `name` renders through KaTeX. Wrap it: `name: "\\mathtt{User}"`,
   `"\\mathtt{ObjectID}"`, `"\\mathtt{address}"`. Bare text renders math-italic — avoid it. Real
   LaTeX for anything mathematical.
3. **Snap to the grid, always.** Grid pitch **50px** (`GRID_SIZE`), forms **200px** (`BASE_SIZE`).
   Put form centres on grid intersections (`position = centre − 100`); run each through the editor's
   `snapCenterPosition` (`components/editor/domain/grid.ts`). Never arbitrary coordinates.
4. **Each branch is its own wire.** A fork = separate `Line` objects from the same source point,
   each with its own `name`. Never one `Line` with multiple `targets` when the branches need
   different names.

### Edge keys per shape

| shape | edge keys |
|---|---|
| square | `top`, `right`, `bottom`, `left` |
| circle | `up`, `right`, `down`, `left` |
| triangle | `a`, `b`, `c` (base), `peak` (apex, ≤1 point) |
| rhombus | `top-right`, `bottom-right`, `bottom-left`, `top-left` |
| empty | `self` |

## Drawing with the MCP

Tools: `list_organizations`, `list_diagrams`, `get_diagram`, `create_diagram`, `update_diagram`,
`rename_diagram`, `delete_diagram` (needs `confirm: true`), `duplicate_diagram`; drawing ops
`add_form`, `add_point`, `add_line`, `remove_element`, `set_element_name`, `move_form`;
`validate_diagram`, `import_diagram`, `export_diagram` (`json` | `tikz` | `html`).

Build the full `{schemaVersion, forms, points, lines}` and `create_diagram`/`update_diagram`, or
draw incrementally with the ops. Every write is validated (dangling references are refused). Before
any write: points labelled with types, wires named, no gratuitous colour, all `\mathtt{…}`, all
positions grid-snapped, forks as separate wires, relations sourced on the owning side.
