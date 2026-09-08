// A local, runtime-identical stand-in for the xyflow/react library's
// `Position` enum.
//
// Exists so the headless domain layer (domain/, ir/, persist/, export/) can
// be imported by a plain Node process (e.g. the MCP server) without pulling
// in React or xyflow — this file has zero dependencies. The string values
// MUST stay byte-identical to xyflow/system's own Position enum (see the
// "xyflow" org's "system" package under node_modules/, dist/esm/index.js),
// since the UI layer casts values produced here straight into xyflow's
// <Handle position={...}> prop.
export const Position = {
  Left: 'left',
  Top: 'top',
  Right: 'right',
  Bottom: 'bottom',
} as const

export type Position = (typeof Position)[keyof typeof Position]
