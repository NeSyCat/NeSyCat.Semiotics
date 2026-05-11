# 02-wireframe

Low-fidelity wireframe of the editor's UI chrome (everything around the React
Flow canvas). Open `index.html` in a browser to view.

## What's in scope

The shell around the canvas:

- Left sidebar (logo, search, diagrams list, collapse toggle).
- Top-left floating toolbar ("Kinds ▾" dropdown + "Straight | Smooth" toggle).
- Top-right JSON panel (closed and open states).
- Bottom-left zoom controls (built-in React Flow `<Controls />`).
- Star-prompt modal (idle-triggered overlay).

Each is rendered as a separate "scene" so we can iterate on regions
independently and capture multiple states (Scene 1 default, Scene 2 sidebar
collapsed, Scene 3 Kinds menu open, Scene 4 JSON panel open, Scene 5 star
modal).

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
