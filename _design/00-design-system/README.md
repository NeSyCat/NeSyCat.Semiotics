# 00-design-system

The visual primitives the editor is built from — colours, typography, fonts,
effects, the shape palette — copied here for design-time reference.

Open `index.html` in a browser to see the style guide.

## Source of truth

The app is the canonical home for these tokens:

- `app/globals.css` — `:root { … }` block + `@layer components { .t-* }` typography.
- `components/editor/style/theme.ts` — typed facade plus TS-only values (node
  opacities, text shadows, the SVG grid colour).
- `components/editor/color.ts` — `DEFAULT_COLOR` shape palette.
- `app/layout.tsx` — Geist Sans / Geist Mono via `next/font/google`.

`tokens.css` here is a **copy**, not a link. When the redesign lands in the
app, port the changes back into those files and resync this copy.

## Consuming from later phases

Each later phase pulls `tokens.css` with a relative link so the wireframe,
mockup, and prototype all share the same primitives:

```html
<link rel="stylesheet" href="../00-design-system/tokens.css" />
```

Fonts are loaded directly from Google Fonts in each phase's HTML so the
static pages don't depend on the Next.js runtime.
