# 02-wireframe

Low-fidelity wireframe of the editor's UI chrome (everything around the React
Flow canvas). Open `index.html` in a browser to view.

## What's in scope

The shell around the canvas:

- **Top bar** — 52 px horizontal strip with the logo on the left, one
  shape-tool button per editable field of `Shape<K>` from
  `components/editor/types.ts` (`name`, `points`, `kind`, `order`,
  `color`, `transform`, `equations`, `weight`) centered, and a share
  control on the right. File management (search, diagram list, +new)
  is not in the wireframe — it'll live in a separate picker.
- **Diagram-data panel** opened by the share control (top-right of the
  canvas), reusing the `.tool-popover` shell.
- **Bottom-left zoom controls** (built-in React Flow `<Controls />`).
- **Star-prompt modal** (idle-triggered overlay).

Each scene is one 1728×1080 frame; we iterate on regions
independently and capture multiple states.

| # | Scene | What it shows |
|---|---|---|
| 1 | default state | baseline editor with the topbar |
| 5 | `name` popover | rename input + visibility dot in the head |
| 6 | `points` popover | header only — visibility dot (no editor) |
| 7 | `kind` popover | one column per `ShapeKind` — per-kind visibility dot + drag tile |
| 8 | `order` popover | Fresco-style discrete slider + numeric input |
| 9 | `color` popover | HSV ring + S/V field + corner presets + HSB/α + swatches |
| 10 | `transform` popover | Scale / Translate / Rotate rows |
| 11 | `equations` popover | list + `+` add in the head |
| 12 | `weight` popover | continuous slider, numeric field above the track |
| 13 | diagram-data panel | top-right `.tool-popover` with Export / Import + JSON |
| 14 | star-prompt modal | idle-triggered overlay |

Every shape-tool popover shares the same `.tool-popover` shell: a
`.head` (caption + visibility dot, optionally `.actions`) and a `.body`.
The visibility dot is binary (`.head-vis-toggle.is-on` / not) — clicking
toggles whether the slot's visualisation is drawn on the canvas. Scene 7
adds a column-level dot per `ShapeKind` so individual kinds can be
hidden without affecting the others.

Popover horizontal positioning is parametric: each instance carries
`style="--tool-index: <0..7>"` and the stylesheet resolves
`left = --shape-cluster-start + index × --shape-tool-stride`. Moving
the topbar geometry edits two CSS vars on `.editor-frame`, not eight
inline pixel values.

The right margin of Scene 1 carries an annotation column with redesign-hook
notes — concrete observations about the current layout that the next
iteration should address.

## What's out of scope

- The React Flow canvas itself — shapes, points, wires, the JSON spine
  rendering. Drawn as a labelled placeholder.
- Inline node UI inside the canvas (double-click rename, canvas `+` buttons).
- Anything below the `app/` layer (data model, mutations, RLS).

## Editing

Plain HTML + CSS, no build step. Edit `index.html` and `styles.css` by hand.
Tokens come from `../00-design-system/tokens.css` via `@import` in
`styles.css`, so colours and typography stay consistent with the app
automatically.

## Output

When iteration converges, hand `index.html` to the `03-mockup/` phase to pin
visual fidelity, then `04-prototype/` for interactivity.
