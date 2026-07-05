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
