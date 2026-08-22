// Minimal reimplementation, NOT the vendoring pattern used elsewhere in this
// directory. `domain/forms.ts` (below) is otherwise a byte-for-byte copy of
// `components/editor/domain/forms.ts`, which imports `Position` from
// `@xyflow/react` — a React Flow package this Node-only MCP server has no
// business depending on (it would pull react/react-dom into a stdio CLI
// tool). Verified empirically that `Position` itself is nothing more than
// this same four-member string enum (@xyflow/system/dist/esm/index.js,
// re-exported by @xyflow/react) — forms.ts only ever reads `.Left/.Top/
// .Right/.Bottom` off it as anchor-facing labels (Anchor.position), never
// anything React/DOM. This shim is behavior-identical to the real export,
// not an approximation of it.
export enum Position {
  Left = 'left',
  Top = 'top',
  Right = 'right',
  Bottom = 'bottom',
}
