# 02-wireframe

Low-fidelity wireframe of the editor's UI chrome (everything around the React
Flow canvas). Open `index.html` in a browser to view.

## What's in scope

The shell around the canvas:

- Left sidebar — Shape-spine tool rail. 56-wide vertical strip with the
  logo on top and one icon button per user-facing slot of `Shape<K>` from
  `components/editor/types.ts` (slots −1 through 6 — `name`, `points`,
  `kind`, `order`, `color`, `transform`, `equations`, `weight`). File
  management (search, diagram list, +new) is no longer in the sidebar.
- Top-left floating toolbar ("Kinds ▾" dropdown + "Straight | Smooth" toggle).
- Top-right JSON panel (closed and open states).
- Bottom-left zoom controls (built-in React Flow `<Controls />`).
- Star-prompt modal (idle-triggered overlay).

Each is rendered as a separate "scene" so we can iterate on regions
independently and capture multiple states. The rail is fixed — no
collapsed-sidebar variant.

| # | Scene | What it shows |
|---|---|---|
| 1 | default state | baseline editor with the icon rail |
| 5 | `name` popover | rename input + visibility footer |
| 6 | `points` popover | hint + visibility footer (no editor) |
| 7 | `kind` popover | 5-shape picker + visibility footer |
| 8 | `order` popover | Fresco-style vertical slider + visibility footer |
| 9 | `color` popover | full HSV + sliders + swatches + visibility footer |
| 10 | `transform` popover | tx/ty/θ/sx/sy grid + visibility footer |
| 11 | `equations` popover | equations list + add + visibility footer |
| 12 | `weight` popover | continuous slider + visibility footer |
| 13 | Kinds menu | legacy top-left dropdown (binary on/off toggles) |
| 14 | JSON panel | top-right glass panel + Export / Import |
| 15 | star-prompt modal | idle-triggered overlay |

Each tool popover follows the same shape: **header (slot name) → editor
body → 3-state visibility footer** (`Off · Selected · All`). The
visibility footer is parked at the bottom so the editor stays in the
visual foreground; it generalises the binary on/off toggles in the
legacy Kinds menu (Scene 13).

The right margin of Scene 1 carries an annotation column with redesign-hook
notes — concrete observations about the current layout that the next
iteration should address.

## What's out of scope

- The React Flow canvas itself — shapes, points, wires, the JSON spine
  rendering. Drawn as a labelled placeholder.
- Inline node UI inside the canvas (double-click rename, slot `+` buttons).
- Anything below the `app/` layer (data model, mutations, RLS).

## Editing

Plain HTML + CSS, no build step. Edit `index.html` and `styles.css` by hand.
Tokens come from `../00-design-system/tokens.css` via `@import` in
`styles.css`, so colours and typography stay consistent with the app
automatically.

## Output

When iteration converges, hand `index.html` to the `03-mockup/` phase to pin
visual fidelity, then `04-prototype/` for interactivity.
