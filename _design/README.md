# _design/

Visual design pipeline, mirroring `02-Design.01..04` from the project taxonomy.

| Folder | Phase | Output |
|---|---|---|
| `00-design-system/` | tokens + style guide | CSS vars + typography utilities (copied from the app) |
| `01-sketch/` | hand-sketches | `.pdf`, `.pic` |
| `02-wireframe/` | structure | HTML+CSS, no styling fidelity |
| `03-mockup/` | full visual | HTML+CSS, pixel-perfect |
| `04-prototype/` | interactive | HTML+CSS+JS |

`00-design-system/` is a static reference, not a phase per se — it pulls the
app's existing tokens (colours, typography, fonts, effects, shape palette)
into one place so every later phase consumes the same primitives via
`<link rel="stylesheet" href="../00-design-system/tokens.css">`. Source of
truth still lives in the app (`app/globals.css`,
`components/editor/style/theme.ts`, `components/editor/color.ts`); the copy
here is for design-time iteration only.

Each subsequent phase's output is the next phase's input. The final
prototype is what gets translated into React inside `/app/` and
`/components/`.
