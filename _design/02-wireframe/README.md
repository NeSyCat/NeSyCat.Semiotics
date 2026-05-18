# 02-wireframe

Low-fidelity wireframe of the editor's UI chrome (everything around the React
Flow canvas). Open `index.html` in a browser to view.

## What's in scope

The shell around the canvas:

- **Floating Spine pill** — centred over the canvas, holding **eight category
  buttons** in this order: **Weight**, **Direction**, **Rotation**, **Scale**,
  **Location**, **Number**, **Color**, **Shape**. (Positions 7–9 — Level,
  Class, Equations — are temporarily removed and will be reinstated later.)
- **Bottom-left zoom controls** (built-in React Flow `<Controls />`).

Each scene is one 1728×1080 frame. Three popover families cover the
eight categories:

| Family | Categories | Layout |
|---|---|---|
| **8-cell rail** | Direction, Number, Color, Shape | one `.topbar-tools.topbar-tools--popover-rail` row of eight cells; left = 0, right = 1 |
| **Bounds slider** | Weight, Rotation, Scale | `0` reset (col 0) · Fresco track (cols 1–6, ~186 px rail) · `1` value field (col 7) |
| **xy extras** | Location | `0` reset · X field · Y field |

| # | Scene | What it shows |
|---|---|---|
| 0 | nothing selected | empty 8-cell Spine, no popover |
| 1 | Weight | bounds slider |
| 2 | Direction | 8-cell rail: Inside · Outside · \| · Center · South · North · Left · Right |
| 3 | Rotation | bounds slider |
| 4 | Scale | bounds slider |
| 5 | Location | xy extras (`0` reset + X + Y) |
| 6 | Number | 8-cell rail: 0 · 1 · 2 · 3 · 4 · 5 · 6 · 10 |
| 7 | Color | 8-cell rail: Black · Red · Orange · Yellow · Green · Cyan · Azure · White |
| 8 | Shape | 8-cell rail: Circle · Point · Line · Triangle · Rhombus · Pentagon · Hexagon · Square |

One rendering path per category: the Spine button mirrors the selected rail
cell pixel-for-pixel. Color is a `.sw-face` span in both contexts. Number is
a plain digit in both contexts (mono, 14 px). Direction / Shape are SVG
glyphs with matching size and stroke-width in both contexts.

The eight-cell Spine and all inspector popovers share one footprint:
`.tool-popover` with `left` = `--shape-pill-left` and `width` =
`--shape-pill-width` (**278 px** centred pill; inspectors dock at
`--popover-top` below it). Edit `.editor-frame` vars to shift the rail;
all inspectors stay aligned.

Hover IS the selection. `.is-active` paints the same soft-circle hover so
each scene renders the tool that "would be hovered" to open its popover.

## Temporarily removed (reinstated later)

- **Spine positions 7–9**: Level, Class, Equations
- **Direction rail**: NW, NE, North (positions 7–9)
- **Number rail**: digits 7, 8, 9 (positions 7–9)
- **Color rail**: Indigo, Magenta, Rose (positions 7–9)
- **Shape rail**: Heptagon, Octagon, Enneagon (positions 7–9)

## What's out of scope

- The React Flow canvas itself — shapes, points, wires, the JSON spine
  rendering. Drawn as a labelled placeholder.
- Inline node UI inside the canvas.
- Anything below the `app/` layer (data model, mutations, RLS).

## Editing

Plain HTML + CSS, no build step. **Icons** are inline `<symbol>` defs at the
top of `index.html` (referenced via `<svg><use href="#ic-…"/>` / `#kind-…`):
no CDN, works fully offline once the file is saved locally. Edit
`index.html` / `styles.css` by hand.

Tokens come from `../00-design-system/tokens.css` via `@import` in
`styles.css`, so colours and typography stay consistent with the app
automatically.

## Output

When iteration converges, hand `index.html` to the `03-mockup/` phase to pin
visual fidelity, then `04-prototype/` for interactivity.
