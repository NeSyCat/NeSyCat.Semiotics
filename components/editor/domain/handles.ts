// React Flow handle-id grammar: `${edgeKey}:${index}`.
// One point on a form edge → one handle. The index is the point's position in
// that edge's ordered list. Both endpoints of a Line resolve through this.

export function encodeHandle(edgeKey: string, index: number): string {
  return `${edgeKey}:${index}`
}

export function decodeHandle(handleId: string): { edgeKey: string; index: number } {
  const i = handleId.lastIndexOf(':')
  return { edgeKey: handleId.slice(0, i), index: parseInt(handleId.slice(i + 1), 10) }
}

// A phantom handle sits at a point-creation region that has no point yet —
// rendered only while that region is hovered, so pulling a line straight out
// of the ring goes through React Flow's OWN native connection-drag system
// (same as dragging from a real point), rather than a hand-rolled parallel
// one. Canvas.tsx resolves it into a real point (via addPoint) the moment a
// connection actually completes from/to it.
const PHANTOM_PREFIX = 'phantom:'

export function encodePhantomHandle(edgeKey: string): string {
  return PHANTOM_PREFIX + edgeKey
}

export function decodePhantomHandle(handleId: string): string | null {
  return handleId.startsWith(PHANTOM_PREFIX) ? handleId.slice(PHANTOM_PREFIX.length) : null
}
