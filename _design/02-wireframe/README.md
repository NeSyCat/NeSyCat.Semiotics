# 02-wireframe

Low-fidelity wireframe of the editor's UI chrome (everything around the React
Flow canvas). Open `index.html` in a browser to view.

## What's in scope

The shell around the canvas:

- **Floating Spine pill** — centred over the canvas: lowercase **`id`**, eight
  `Shape<K>` affordances (<code>name … weight</code> from <code>types.ts</code>), plus
  wireframe middot stub **column&nbsp;9** and **`?`** **column&nbsp;10** (**eleven** cells total —
  aligns with rails using indices <strong>0 … 10</strong>), and a separate share pill top-right.
- **Diagram-data panel** opened by the share control (top-right of the
  canvas), reusing the `.tool-popover` shell.
- **Bottom-left zoom controls** (built-in React Flow `<Controls />`).
- **Star-prompt modal** (idle-triggered overlay).

Each scene is one 1728×1080 frame; we iterate on regions
independently and capture multiple states.

| # | Scene | What it shows |
|---|---|---|
| 1 | default state | baseline editor with eleven-cell Spine (`id` + Name…Weight + **`·`** + **`?`**) |
| 5 | `name` popover | rename input + visibility dot in the head |
| 6 | `points` popover | dashed **square** (col 0) · Spine stroke **chevrons** L/R/D/U ×2 · centre **thin +** (two crossing strokes, same weight as chevrons) |
| 7 | `kind` popover | spine-width bezel; tessera **0…10** — one <code>.topbar-tools.kind-rail</code> child (parity with Points / Order / Colour / Equations) |
| 8 | `order` popover | digits **`0`**…**`10`** (`10` styled slightly tighter) |
| 9 | `color` popover | **Black** · HSV ramps at **hue** 0° 30° 60° 120° 180° 210° 240° 270° 300° (S=V=100% in the stub) · **White** far right |
| 10 | `transform` popover | Single pill · x · y · θ · **S** (uniform scale) |
| 11 | `equations` popover | Spine-width capsule; **STIX Two Math** (Google Fonts): **0**, **min / max / inf / sup**, **+ − × ÷**, **∑** (**`\sum`**), **∏** (**`\prod`**) — 11 cols **0 … 10** |
| 12 | `weight` popover | Spine-aligned row — **0** reset (column&nbsp;0) · Fresco host **304 px** cols&nbsp;1–9 rail drawn ~**288 px** (**8 px** inset sides), **12px** mono digits · value field column&nbsp;10 |
| 13 | diagram-data panel | top-right `.tool-popover` with Export / Import + JSON |
| 14 | star-prompt modal | idle-triggered overlay |

The **eleven-cell** Spine (<code>id</code> · eight <code>Shape</code> fields · middot stub · **`?`**) and inspectors share one footprint: `.tool-popover`
with **`left`** = **`--shape-pill-left`** and **`width`** = **`--shape-pill-width`**
(380 px — centred pill; inspectors dock at **`--popover-top`** below it).
Columns <strong>0 … 10</strong>: kind empty-form aligns with digit <strong>0</strong> / black swatch left; middot Spine **column 9** aligns **order 9** · ninth hue preset (kind tessera&nbsp;<strong>9</strong> is <strong>nonagon</strong>); Spine **`?`** aligns **digit 10** · **white** with kind tessera <strong>circle</strong> slot&nbsp;<strong>10</strong>.
Diagram data uses **`.tool-popover.tool-popover--diagram`** (top-right). Edit
`.editor-frame` vars to shift the rail; all inspectors stay aligned.
Spine-width inspectors (<strong>points</strong>, <strong>order</strong>, <strong>colour</strong>, <strong>equations</strong>, <strong>kind</strong>) put <strong>one</strong> <code>.topbar-tools.topbar-tools--popover-rail …</code> row directly inside the bezel (same shallow DOM / padding as Scene&nbsp;1 centre Spine). Scene&nbsp;12 weight uses <code>.inspector-slider-row--weight-spine</code> directly under its bezel likewise.

The right margin of Scene 1 carries an annotation column with redesign-hook
notes — concrete observations about the current layout that the next
iteration should address.

## What's out of scope

- The React Flow canvas itself — shapes, points, wires, the JSON spine
  rendering. Drawn as a labelled placeholder.
- Inline node UI inside the canvas (double-click rename, canvas `+` buttons).
- Anything below the `app/` layer (data model, mutations, RLS).

## Editing

Plain HTML + CSS, no build step. **Icons** are inline `<symbol>` defs at the top
of `index.html` (referenced via `<svg><use href="#ic-…"/>` / `#kind-…`): no CDN,
works fully offline once the file is saved locally. Shape-spine glyphs are custom
(so they parallel the eventual app affordances rather than pinning to a bundled pack).
Edit `index.html` / `styles.css` by hand.

Tokens come from `../00-design-system/tokens.css` via `@import` in
`styles.css`, so colours and typography stay consistent with the app
automatically.

## Output

When iteration converges, hand `index.html` to the `03-mockup/` phase to pin
visual fidelity, then `04-prototype/` for interactivity.
