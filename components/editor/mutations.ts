// Generic, kind-agnostic mutations on a Diagram. Lines now reference points by
// stable id (no positional addressing); a "point" IS a Shape (typically a leaf
// of kind 'empty') nested inside another shape's `points` slots. All shape ids
// across the diagram (nodes, edges, nested points) live in one universal
// namespace and must be unique.

import type { AnyLine, AnyShape, Diagram, ShapeKind, Slot, Subslot } from './types'
import {
  addPointAt, emptyShapePoints, findShape, getPointAt, modifyAtPath,
  replaceEdge, replaceNode, walkShape,
} from './points'
import { allShapeIds, newLineId, newNodeId, newPointId } from './ids'
import { defaultSpaceTime, withTranslation } from './transform'
import { DEFAULT_COLOR } from './color'
import { restoreDiagram } from './migrations'

// === Constructors ===

function makeShape<K extends ShapeKind>(
  kind: K,
  id: string,
  translation: [number, number] = [0, 0],
  order = 0,
): AnyShape {
  return {
    kind,
    points: emptyShapePoints(kind),
    id,
    order,
    color: DEFAULT_COLOR,
    transform: defaultSpaceTime(translation),
    equations: [],
    weight: 1,
  } as AnyShape
}

function makeLine(id: string, source: string, target: string): AnyLine {
  return {
    kind: 'empty',
    points: emptyShapePoints('empty'),
    id,
    order: 0,
    color: DEFAULT_COLOR,
    transform: defaultSpaceTime(),
    equations: [],
    weight: 1,
    source,
    targets: [target],
  } as AnyLine
}

// === Helpers ===

// Every id inside a shape's recursive tree (including the root).
function collectAllIds(s: AnyShape): Set<string> {
  const ids = new Set<string>()
  for (const inner of walkShape(s)) ids.add(inner.id)
  return ids
}

// Drop / trim every line that references any id in `dropped`.
//   source-hit  → drop the whole line
//   target-hit  → drop just that branch (whole line if last target)
function pruneLines(edges: AnyLine[], dropped: Set<string>): AnyLine[] {
  const out: AnyLine[] = []
  for (const l of edges) {
    if (dropped.has(l.source)) continue
    const targets = l.targets.filter((t) => !dropped.has(t))
    if (targets.length === 0) continue
    out.push({ ...l, targets } as AnyLine)
  }
  return out
}

// Rewrite line endpoints that refer to oldId.
function renameLineRefs(edges: AnyLine[], oldId: string, newId: string): AnyLine[] {
  return edges.map((l) => ({
    ...l,
    source: l.source === oldId ? newId : l.source,
    targets: l.targets.map((t) => (t === oldId ? newId : t)),
  } as AnyLine))
}

// === Top-level node mutations ===

export function addNode(
  d: Diagram,
  kind: ShapeKind,
  position: [number, number] = [0, 0],
): [Diagram, string] {
  const id = newNodeId(d)
  const node = makeShape(kind, id, position, d.nodes.length + 1)
  return [{ ...d, nodes: [...d.nodes, node] }, id]
}

export function addEmpty(d: Diagram, position: [number, number] = [0, 0]): [Diagram, string] {
  return addNode(d, 'empty', position)
}

export function deleteNode(d: Diagram, id: string): Diagram {
  const idx = d.nodes.findIndex((n) => n.id === id)
  if (idx < 0) return d
  const dropped = collectAllIds(d.nodes[idx])
  const nodes = d.nodes.filter((_, i) => i !== idx)
  const edges = pruneLines(d.edges, dropped)
  return { ...d, nodes, edges }
}

export function renameNode(d: Diagram, oldId: string, newId: string): [Diagram, boolean] {
  return renameShape(d, oldId, newId)
}

// === Generic shape rename — works on any shape (top-level or nested). ===
function renameShape(d: Diagram, oldId: string, newId: string): [Diagram, boolean] {
  if (oldId === newId) return [d, true]
  if (!newId.trim()) return [d, false]
  if (allShapeIds(d).has(newId)) return [d, false]
  const loc = findShape(d, oldId)
  if (!loc) return [d, false]
  const replacer = (s: AnyShape): AnyShape => ({ ...s, id: newId } as AnyShape)
  const newTop = modifyAtPath(loc.topShape, loc.path, replacer)
  if (newTop === undefined) return [d, false]
  let nd: Diagram = loc.topContainer === 'nodes'
    ? replaceNode(d, loc.topIndex, newTop)
    : replaceEdge(d, loc.topIndex, newTop as AnyLine)
  nd = { ...nd, edges: renameLineRefs(nd.edges, oldId, newId) }
  return [nd, true]
}

// === Point mutations ===

// Append (or assign, for maybe slots) a new empty-leaf point at the given
// slot/subslot of any shape in the tree (top-level or nested), identified by id.
export function addPoint(
  d: Diagram,
  parentId: string,
  slot: Slot,
  subslot?: Subslot,
): [Diagram, string] {
  const loc = findShape(d, parentId)
  if (!loc) return [d, '']
  const id = newPointId(d)
  const newPt = makeShape('empty', id)
  const replacer = (parent: AnyShape): AnyShape => {
    const { points } = addPointAt(parent.kind, parent.points, slot, subslot, newPt)
    return { ...parent, points } as AnyShape
  }
  const newTop = modifyAtPath(loc.topShape, loc.path, replacer)
  if (newTop === undefined) return [d, '']
  const nd: Diagram = loc.topContainer === 'nodes'
    ? replaceNode(d, loc.topIndex, newTop)
    : replaceEdge(d, loc.topIndex, newTop as AnyLine)
  return [nd, id]
}

// Remove a nested point (and its subtree). Top-level shapes go through
// deleteNode instead. Lines that referenced any id in the removed subtree are
// pruned (source-hit drops line, target-hit drops branch).
export function removePoint(d: Diagram, pointId: string): Diagram {
  const loc = findShape(d, pointId)
  if (!loc) return d
  if (loc.path.length === 0) return d  // top-level shape — wrong API
  const point = walkToPath(loc.topShape, loc.path)
  if (!point) return d
  const dropped = collectAllIds(point)
  const newTop = modifyAtPath(loc.topShape, loc.path, () => undefined)
  if (newTop === undefined) return d
  let nd: Diagram = loc.topContainer === 'nodes'
    ? replaceNode(d, loc.topIndex, newTop)
    : replaceEdge(d, loc.topIndex, newTop as AnyLine)
  nd = { ...nd, edges: pruneLines(nd.edges, dropped) }
  return nd
}

// Walk a path from a top shape down to the inner shape it addresses.
function walkToPath(top: AnyShape, path: { slot: Slot; subslot?: Subslot; index: number }[]): AnyShape | undefined {
  let cur: AnyShape = top
  for (const p of path) {
    const inner = getPointAt(cur.kind, cur.points, p)
    if (inner === undefined) return undefined
    cur = inner
  }
  return cur
}

export function renamePoint(d: Diagram, oldId: string, newId: string): [Diagram, boolean] {
  return renameShape(d, oldId, newId)
}

// === Line mutations ===

export function addLine(d: Diagram, sourcePtId: string, targetPtId: string): [Diagram, string] {
  const id = newLineId(d)
  const line = makeLine(id, sourcePtId, targetPtId)
  return [{ ...d, edges: [...d.edges, line] }, id]
}

export function addLineTarget(d: Diagram, lineId: string, targetPtId: string): Diagram {
  return {
    ...d,
    edges: d.edges.map((l) =>
      l.id !== lineId ? l : ({ ...l, targets: [...l.targets, targetPtId] } as AnyLine),
    ),
  }
}

export function deleteLine(d: Diagram, lineId: string): Diagram {
  return { ...d, edges: d.edges.filter((l) => l.id !== lineId) }
}

export function deleteLineTarget(d: Diagram, lineId: string, idx: number): Diagram {
  const line = d.edges.find((l) => l.id === lineId)
  if (!line) return d
  if (line.targets.length <= 1) return deleteLine(d, lineId)
  return {
    ...d,
    edges: d.edges.map((l) =>
      l.id !== lineId ? l : ({ ...l, targets: l.targets.filter((_, i) => i !== idx) } as AnyLine),
    ),
  }
}

export function renameLine(d: Diagram, oldId: string, newId: string): [Diagram, boolean] {
  return renameShape(d, oldId, newId)
}

// Create a free-floating empty carrier with one point and a line connecting it
// to `anchorPtId`. `freeRole` says which end of the line the free point becomes.
export function addLineWithFreeEnd(
  d: Diagram,
  anchorPtId: string,
  freeRole: 'source' | 'target',
  emptyPosition: [number, number],
): [Diagram, { emptyId: string; lineId: string }] {
  const [d1, emptyId] = addEmpty(d, emptyPosition)
  // Side mirrors the OLD UX: source-end carrier sits to the right (input var),
  // target-end carrier sits to the left (output var).
  const slot: Slot = freeRole === 'source' ? 'right' : 'left'
  const [d2, freePtId] = addPoint(d1, emptyId, slot)
  if (!freePtId) return [d, { emptyId: '', lineId: '' }]
  const [source, target] = freeRole === 'source' ? [freePtId, anchorPtId] : [anchorPtId, freePtId]
  const [d3, lineId] = addLine(d2, source, target)
  return [d3, { emptyId, lineId }]
}

export type LineEnd = { kind: 'source' } | { kind: 'target'; index: number }

// Move one end of a line from its current point to a freshly-added point on
// `parentId` at the given slot/subslot. The previous point is removed; if it
// lived inside an `empty` top-level shape that becomes pointless as a result,
// that empty is auto-deleted (matches OLD attachPoint cleanup behavior).
export function attachLine(
  d: Diagram,
  lineId: string,
  end: LineEnd,
  parentId: string,
  slot: Slot,
  subslot?: Subslot,
): [Diagram, string] {
  const line = d.edges.find((l) => l.id === lineId)
  if (!line) return [d, '']
  const oldPtId = end.kind === 'source' ? line.source : line.targets[end.index]
  if (!oldPtId) return [d, '']

  // Resolve old point's containing top-level node BEFORE mutating.
  const oldLoc = findShape(d, oldPtId)
  const oldTopId =
    oldLoc && oldLoc.topContainer === 'nodes' && oldLoc.path.length > 0
      ? oldLoc.topShape.id
      : undefined

  const [d1, newPtId] = addPoint(d, parentId, slot, subslot)
  if (!newPtId) return [d, '']

  // Repoint the line at the new point.
  const d2: Diagram = {
    ...d1,
    edges: d1.edges.map((l) => {
      if (l.id !== lineId) return l
      if (end.kind === 'source') return { ...l, source: newPtId } as AnyLine
      return {
        ...l,
        targets: l.targets.map((t, i) => (i === end.index ? newPtId : t)),
      } as AnyLine
    }),
  }

  // Drop the now-stale old point (also prunes any other lines that touched it).
  let d3 = removePoint(d2, oldPtId)

  // Orphaned-empty cleanup: if the old point lived in an empty node and that
  // node now has no remaining inner points, drop the carrier.
  if (oldTopId) {
    const top = d3.nodes.find((n) => n.id === oldTopId)
    if (top && top.kind === 'empty') {
      let hasInner = false
      for (const inner of walkShape(top)) {
        if (inner.id !== top.id) {
          hasInner = true
          break
        }
      }
      if (!hasInner) d3 = deleteNode(d3, top.id)
    }
  }

  return [d3, newPtId]
}

// === Translation (one-axis transform mutation) ===

export function updateNodeTranslation(
  d: Diagram,
  nodeId: string,
  translation: [number, number],
): Diagram {
  return {
    ...d,
    nodes: d.nodes.map((n) =>
      n.id === nodeId
        ? ({ ...n, transform: withTranslation(n.transform, translation) } as AnyShape)
        : n,
    ),
  }
}

export function updateNodeTranslations(
  d: Diagram,
  updates: Array<{ id: string; translation: [number, number] }>,
): Diagram {
  if (updates.length === 0) return d
  const byId = new Map(updates.map((u) => [u.id, u.translation]))
  return {
    ...d,
    nodes: d.nodes.map((n) =>
      byId.has(n.id)
        ? ({ ...n, transform: withTranslation(n.transform, byId.get(n.id)!) } as AnyShape)
        : n,
    ),
  }
}

// === Bulk import ===
// Accepts arbitrary persisted JSON; routes through the migration pipeline so the
// store always sees a well-formed Diagram regardless of source schema version.
export function importDiagram(raw: unknown): Diagram {
  return restoreDiagram(raw)
}
