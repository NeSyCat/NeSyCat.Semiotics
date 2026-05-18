# 04-prototype

Interactive prototype — HTML+CSS+JS. Single editor frame; click the Spine,
pick a value, watch the form on the canvas react.

Open `index.html` in any browser (Chrome / Safari / Firefox). No build step.

## What's wired up

The eight Spine categories from `_design/02-wireframe/` are all live:

| Category | Affordance | Effect on the form |
|---|---|---|
| Weight | bounds slider 0..1 | inner polygon scales from centre |
| Direction | 8-cell rail | Spine glyph + rail `.is-active` (v1: visual only) |
| Rotation | bounds slider 0..1 | form rotates 0–360° |
| Scale | bounds slider 0..1 | form scales 0.3..1.0 (kept visible) |
| Location | xy extras | form translates (x, y) px |
| Number | 8-cell rail (0–6, 10) | Spine label + rail `.is-active` + numeric badge |
| Color | 8-cell rail | inner fill + Spine `.sw-face` disk |
| Shape | 8-cell rail | swaps polygon (Circle, Point, Line, Triangle, Rhombus, Pentagon, Hexagon, Square) |

Plus:

- **Bottom name bar** — type to live-edit the form's centre glyph. (No
  LaTeX rendering yet; the input is treated as literal text.)
- **Spine toggle** — only one popover open at a time. Clicking the same
  Spine button again closes its popover. Clicking anywhere outside a
  popover or the Spine closes whatever is open.

## State model

Single source of truth in `script.js`:

```js
const state = {
  weight: 0.36,
  direction: "Center",
  rotation: 0.25,
  scale: 0.50,
  location: { x: 0, y: 0 },
  number: 5,
  color: "#0080ff",
  shape: "Hexagon",
  name: "X",
  openPopover: null,
};
```

Every event handler mutates `state`, then calls `render()` which re-projects
state onto the DOM. One-way data flow, no virtual DOM, no framework.

## Files

```
04-prototype/
├── index.html      single editor frame, all popovers, SVG sprite defs
├── styles.css      @imports ../02-wireframe/styles.css + popover show/hide
├── script.js       state, render, listeners (~300 lines, vanilla)
└── README.md       this file
```

The CSS `@import` chain pulls in the wireframe's `styles.css` (which itself
imports `../00-design-system/tokens.css`), so any visual edit to the
wireframe propagates here automatically. Drop a tweak in `02-wireframe/`,
refresh the prototype, and it picks up the change.

## Out of scope (deferred to React port under `app/` & `components/`)

- Multiple forms on canvas, selection, undo / redo.
- LaTeX → MathML / KaTeX rendering inside the form glyph.
- Keyboard shortcuts (typing anywhere → name bar focus, Quiver-style).
- Drag the form on the canvas to set Location interactively.
- Animation / transitions between states.
- Persisting state across reloads.
- Wiring Direction's semantic effect on the form (currently selection-only).

This is the last static phase before code is translated into React under
`/app/` and `/components/`.
