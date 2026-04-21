import type { DiagramData, DiagramEmpty, DiagramPoint, XY } from './types'

type Side = 'left' | 'right'
type NodeSide = 'left' | 'right' | 'center' | 'down' | 'up' | 'total'
type Slot = 'down' | 'center' | 'up'

export function nextName(prefix: string, existing: string[]): string {
  const taken = new Set(existing)
  let n = 1
  while (taken.has(`${prefix}${n}`)) n++
  return `${prefix}${n}`
}

export function allNodeNames(d: DiagramData): string[] {
  return [
    ...d.empties.map((e) => e.id),
    ...d.triangles.map((t) => t.id),
    ...d.rhombuses.map((r) => r.id),
    ...d.circles.map((c) => c.id),
    ...d.rectangles.map((r) => r.id),
  ]
}

export function allPointNames(d: DiagramData): string[] {
  const names: string[] = []
  for (const e of d.empties) {
    if (e.points.left) names.push(e.points.left.name)
    if (e.points.right) names.push(e.points.right.name)
  }
  for (const t of d.triangles) {
    names.push(...t.points.left.map((p) => p.name))
    names.push(...t.points.right.map((p) => p.name))
    if (t.points.center) names.push(t.points.center.name)
    names.push(t.points.total.name)
  }
  for (const r of d.rectangles) {
    for (const s of [r.points.left, r.points.right]) {
      if (s.down) names.push(s.down.name)
      names.push(...s.center.map((p) => p.name))
      if (s.up) names.push(s.up.name)
    }
    if (r.points.center.up) names.push(r.points.center.up.name)
    if (r.points.center.center) names.push(r.points.center.center.name)
    if (r.points.center.down) names.push(r.points.center.down.name)
    names.push(...r.points.down.map((p) => p.name))
    names.push(...r.points.up.map((p) => p.name))
    names.push(r.points.total.name)
  }
  for (const c of d.circles) {
    names.push(...c.points.left.map((p) => p.name))
    names.push(...c.points.right.map((p) => p.name))
    names.push(...c.points.up.map((p) => p.name))
    names.push(...c.points.down.map((p) => p.name))
    if (c.points.center.up) names.push(c.points.center.up.name)
    if (c.points.center.center) names.push(c.points.center.center.name)
    if (c.points.center.down) names.push(c.points.center.down.name)
    names.push(c.points.total.name)
  }
  for (const r of d.rhombuses) {
    for (const s of [r.points.left, r.points.right]) {
      names.push(...s.down.map((p) => p.name), ...(s.center ? [s.center.name] : []), ...s.up.map((p) => p.name))
    }
    if (r.points.center.up) names.push(r.points.center.up.name)
    if (r.points.center.center) names.push(r.points.center.center.name)
    if (r.points.center.down) names.push(r.points.center.down.name)
    if (r.points.up) names.push(r.points.up.name)
    if (r.points.down) names.push(r.points.down.name)
    names.push(r.points.total.name)
  }
  return names
}

function updateLineRefs(d: DiagramData, oldName: string, newName: string): DiagramData['lines'] {
  const updateLP = (lp: DiagramPoint): DiagramPoint => lp.node === oldName ? { ...lp, node: newName } : lp
  return d.lines.map((l) => ({
    ...l,
    points: { source: updateLP(l.points.source), targets: l.points.targets.map(updateLP) },
  }))
}

// Remove all references to a node from lines: drop targets pointing at it,
// drop whole line if its source points at it or if targets becomes empty.
function removeNodeLines(d: DiagramData, nodeName: string): DiagramData['lines'] {
  const out: DiagramData['lines'] = []
  for (const l of d.lines) {
    if (l.points.source.node === nodeName) continue
    const targets = l.points.targets.filter((t) => t.node !== nodeName)
    if (targets.length === 0) continue
    out.push({ ...l, points: { source: l.points.source, targets } })
  }
  return out
}

// ===== Points on nodes =====

export function addPoint(d: DiagramData, nodeName: string, side: NodeSide, label?: string, slot?: Slot): [DiagramData, number] {
  if (side === 'total') return [d, 0]
  // Node-level center: triangle keeps its single-point legacy; rectangle/circle/rhombus use
  // a 3-slot column { down?, center?, up? } (all optional, selected via the slot arg).
  if (side === 'center') {
    const sl: Slot = slot ?? 'center'
    const name = label ?? nextName('P', allPointNames(d))
    const pt: DiagramPoint = { name }
    const putCol = <C extends { points: { center: { down?: DiagramPoint; center?: DiagramPoint; up?: DiagramPoint } } }>(c: C): C =>
      c.points.center[sl] ? c : { ...c, points: { ...c.points, center: { ...c.points.center, [sl]: pt } } }
    return [{
      ...d,
      triangles:  d.triangles .map((t) => t.id !== nodeName || t.points.center ? t : { ...t, points: { ...t.points, center: pt } }),
      circles:    d.circles   .map((c) => c.id === nodeName ? putCol(c) : c),
      rectangles: d.rectangles.map((r) => r.id === nodeName ? putCol(r) : r),
      rhombuses:  d.rhombuses .map((r) => r.id === nodeName ? putCol(r) : r),
    }, 0]
  }

  // Rectangle / circle down / up edge — stackable arrays.
  // Rhombus down / up corner — single optional point.
  if (side === 'down' || side === 'up') {
    const rhombus = d.rhombuses.find((r) => r.id === nodeName)
    if (rhombus) {
      if (rhombus.points[side]) return [d, 0]
      const pt: DiagramPoint = { name: label ?? nextName('P', allPointNames(d)) }
      return [{
        ...d,
        rhombuses: d.rhombuses.map((r) => r.id === nodeName ? { ...r, points: { ...r.points, [side]: pt } } : r),
      }, 0]
    }
    const circle = d.circles.find((c) => c.id === nodeName)
    if (circle) {
      const pt: DiagramPoint = { name: label ?? nextName('P', allPointNames(d)) }
      const newIndex = circle.points[side].length
      return [{
        ...d,
        circles: d.circles.map((c) => c.id === nodeName ? { ...c, points: { ...c.points, [side]: [...c.points[side], pt] } } : c),
      }, newIndex]
    }
    const rect = d.rectangles.find((r) => r.id === nodeName)
    if (!rect) return [d, 0]
    const pt: DiagramPoint = { name: label ?? nextName('P', allPointNames(d)) }
    const newIndex = rect.points[side].length
    return [{
      ...d,
      rectangles: d.rectangles.map((r) => r.id === nodeName ? { ...r, points: { ...r.points, [side]: [...r.points[side], pt] } } : r),
    }, newIndex]
  }

  const isTri = d.triangles.some((t) => t.id === nodeName)
  // Empty branch — at most one point per side; both sides must share the same name
  const empty = d.empties.find((e) => e.id === nodeName)
  if (empty) {
    if (empty.points[side]) return [d, 0]
    const sibling = side === 'left' ? empty.points.right : empty.points.left
    const emptyName = label ?? sibling?.name ?? nextName('P', allPointNames(d))
    const emptyPt: DiagramPoint = { name: emptyName }
    return [{
      ...d,
      empties: d.empties.map((e) => e.id !== nodeName ? e : {
        ...e,
        points: { ...e.points, [side]: emptyPt },
      }),
    }, 0]
  }

  const isRhombusRightCenter = slot === 'center' && side === 'right' && d.rhombuses.some((r) => r.id === nodeName)
  const isTriRight = isTri && side === 'right'
  const pt: DiagramPoint = { name: label ?? ((isTri || isRhombusRightCenter || isTriRight) ? 'τ' : nextName('P', allPointNames(d))) }

  let newIndex = -1
  const tri = d.triangles.find((t) => t.id === nodeName)
  if (tri && side === 'left') {
    newIndex = tri.points.left.length
  } else if (tri && side === 'right') {
    newIndex = tri.points.right.length
  } else {
    const rect = d.rectangles.find((r) => r.id === nodeName)
    if (rect) {
      const sd = rect.points[side]
      if (slot === 'up' || slot === 'down') {
        if (sd[slot]) return [d, 0]
        newIndex = 0
      } else {
        newIndex = sd.center.length
      }
    } else {
      const circle = d.circles.find((c) => c.id === nodeName)
      if (circle) {
        newIndex = circle.points[side].length
      } else {
        const rhombus = d.rhombuses.find((r) => r.id === nodeName)
        if (rhombus) {
          if (slot === 'center') {
            newIndex = 0
          } else {
            const sl: 'down' | 'up' = slot ?? 'down'
            newIndex = rhombus.points[side][sl].length
          }
        }
      }
    }
  }
  return [{
    ...d,
    triangles: d.triangles.map((t) => {
      if (t.id !== nodeName) return t
      if (side === 'left') return { ...t, points: { ...t.points, left: [...t.points.left, pt] } }
      if (side === 'right') return { ...t, points: { ...t.points, right: [...t.points.right, pt] } }
      return t
    }),
    rectangles: d.rectangles.map((r) => {
      if (r.id !== nodeName) return r
      const sd = r.points[side]
      if (slot === 'up' || slot === 'down') {
        if (sd[slot]) return r
        return { ...r, points: { ...r.points, [side]: { ...sd, [slot]: pt } } }
      }
      return { ...r, points: { ...r.points, [side]: { ...sd, center: [...sd.center, pt] } } }
    }),
    circles: d.circles.map((c) => {
      if (c.id !== nodeName) return c
      return { ...c, points: { ...c.points, [side]: [...c.points[side], pt] } }
    }),
    rhombuses: d.rhombuses.map((r) => {
      if (r.id !== nodeName) return r
      const sd = r.points[side]
      if (slot === 'center') {
        if (sd.center) return r
        return { ...r, points: { ...r.points, [side]: { ...sd, center: pt } } }
      }
      const sl: 'down' | 'up' = slot ?? 'down'
      return { ...r, points: { ...r.points, [side]: { ...sd, [sl]: [...sd[sl], pt] } } }
    }),
  }, newIndex]
}

export type LineEnd = { kind: 'source' } | { kind: 'target'; index: number }

// Move a line's endpoint from wherever it currently lives onto a point newly added to a visible node.
// Auto-deletes the previous empty carrier if it becomes orphaned.
export function attachPoint(d: DiagramData, lineName: string, end: LineEnd, nodeName: string, side: Side | 'up' | 'down', slot?: Slot): [DiagramData, number] {
  const line = d.lines.find((l) => l.id === lineName)
  if (!line) return [d, -1]
  const prevEnd = end.kind === 'source' ? line.points.source : line.points.targets[end.index]
  if (!prevEnd) return [d, -1]
  const label = prevEnd.name
  const [withPoint, newIndex] = addPoint(d, nodeName, side, label, slot)
  const attached: DiagramPoint = { name: label, node: nodeName, side, index: newIndex, ...(slot ? { slot } : {}) }
  let d2: DiagramData = {
    ...withPoint,
    lines: withPoint.lines.map((l) => {
      if (l.id !== lineName) return l
      if (end.kind === 'source') return { ...l, points: { source: attached, targets: l.points.targets } }
      return { ...l, points: { source: l.points.source, targets: l.points.targets.map((t, i) => i === end.index ? attached : t) } }
    }),
  }
  // Clean up orphaned empty the line was previously anchored to
  const prevEmpty = prevEnd.node ? d2.empties.find((e) => e.id === prevEnd.node) : undefined
  if (prevEmpty) {
    const prevSide = prevEnd.side as Side
    const others: Partial<DiagramEmpty['points']> = {}
    if (prevSide !== 'left' && prevEmpty.points.left) others.left = prevEmpty.points.left
    if (prevSide !== 'right' && prevEmpty.points.right) others.right = prevEmpty.points.right
    if (others.left || others.right) {
      d2 = { ...d2, empties: d2.empties.map((e) => e.id === prevEmpty.id ? { ...e, points: others } : e) }
    } else {
      d2 = { ...d2, empties: d2.empties.filter((e) => e.id !== prevEmpty.id) }
    }
  }
  return [d2, newIndex]
}

export function removePointOnNode(d: DiagramData, nodeName: string, side: NodeSide, index: number, slot?: Slot): DiagramData {
  if (side === 'total') return d
  const rm = (pts: DiagramPoint[], i: number) => pts.filter((_, j) => j !== i)
  const updateLP = (lp: DiagramPoint): DiagramPoint | null => {
    if (lp.node !== nodeName || lp.side !== side || lp.slot !== slot) return lp
    if (lp.index === index) return null
    if (lp.index !== undefined && lp.index > index) return { ...lp, index: lp.index - 1 }
    return lp
  }
  const newLines: DiagramData['lines'] = []
  for (const l of d.lines) {
    const s = updateLP(l.points.source)
    if (s === null) continue
    const targets: DiagramPoint[] = []
    for (const t of l.points.targets) {
      const nt = updateLP(t)
      if (nt !== null) targets.push(nt)
    }
    if (targets.length === 0) continue
    newLines.push({ ...l, points: { source: s, targets } })
  }

  // Empty branch — auto-delete the empty if its last point was removed
  let newEmpties = d.empties
  const empty = d.empties.find((e) => e.id === nodeName)
  if (empty) {
    const others: Partial<DiagramEmpty['points']> = {}
    if (side !== 'left' && empty.points.left) others.left = empty.points.left
    if (side !== 'right' && empty.points.right) others.right = empty.points.right
    if (others.left || others.right) {
      newEmpties = d.empties.map((e) => e.id === nodeName ? { ...e, points: others } : e)
    } else {
      newEmpties = d.empties.filter((e) => e.id !== nodeName)
    }
  }

  return {
    ...d,
    empties: newEmpties,
    triangles: d.triangles.map((t) => {
      if (t.id !== nodeName) return t
      if (side === 'left') return { ...t, points: { ...t.points, left: rm(t.points.left, index) } }
      if (side === 'right') return { ...t, points: { ...t.points, right: rm(t.points.right, index) } }
      if (side === 'center') { const { center: _c, ...rest } = t.points; return { ...t, points: rest } }
      return t
    }),
    rectangles: d.rectangles.map((r) => {
      if (r.id !== nodeName) return r
      if (side === 'center') {
        const sl: Slot = slot ?? 'center'
        const { [sl]: _x, ...rest } = r.points.center
        return { ...r, points: { ...r.points, center: rest } }
      }
      if (side === 'down' || side === 'up') return { ...r, points: { ...r.points, [side]: rm(r.points[side], index) } }
      const sd = r.points[side]
      if (slot === 'up' || slot === 'down') {
        const { [slot]: _x, ...rest } = sd
        return { ...r, points: { ...r.points, [side]: rest } }
      }
      return { ...r, points: { ...r.points, [side]: { ...sd, center: rm(sd.center, index) } } }
    }),
    circles: d.circles.map((c) => {
      if (c.id !== nodeName) return c
      if (side === 'center') {
        const sl: Slot = slot ?? 'center'
        const { [sl]: _x, ...rest } = c.points.center
        return { ...c, points: { ...c.points, center: rest } }
      }
      if (side === 'left' || side === 'right' || side === 'up' || side === 'down') {
        return { ...c, points: { ...c.points, [side]: rm(c.points[side], index) } }
      }
      return c
    }),
    rhombuses: d.rhombuses.map((r) => {
      if (r.id !== nodeName) return r
      if (side === 'up') {
        const { up: _u, ...rest } = r.points
        return { ...r, points: rest }
      }
      if (side === 'down') {
        const { down: _d, ...rest } = r.points
        return { ...r, points: rest }
      }
      if (side === 'center') {
        const sl: Slot = slot ?? 'center'
        const { [sl]: _x, ...rest } = r.points.center
        return { ...r, points: { ...r.points, center: rest } }
      }
      if (side !== 'left' && side !== 'right') return r
      if (!slot) return r
      const sd = r.points[side]
      if (slot === 'center') {
        const { center: _c, ...rest } = sd
        return { ...r, points: { ...r.points, [side]: rest } }
      }
      return { ...r, points: { ...r.points, [side]: { ...sd, [slot]: rm(sd[slot], index) } } }
    }),
    lines: newLines,
  }
}

export function setPointLabel(d: DiagramData, nodeName: string, side: NodeSide, index: number, label: string, slot?: Slot): DiagramData {
  // BFS: all slots transitively connected via lines (all line endpoints now live on real nodes)
  type PointRef = { node: string; side: NodeSide; slot?: Slot; index: number }
  const key = (s: PointRef) => `${s.node}|${s.side}|${s.slot ?? ''}|${s.index}`
  const visited = new Set<string>()
  const queue: PointRef[] = [{ node: nodeName, side, slot, index }]
  visited.add(key(queue[0]))

  while (queue.length > 0) {
    const ref = queue.shift()!
    for (const line of d.lines) {
      const follow = (from: DiagramPoint, to: DiagramPoint) => {
        if (from.node === ref.node && from.side === ref.side && from.slot === ref.slot && from.index === ref.index
            && to.node && to.side && to.index !== undefined) {
          const k = key({ node: to.node, side: to.side, slot: to.slot, index: to.index })
          if (!visited.has(k)) { visited.add(k); queue.push({ node: to.node, side: to.side, slot: to.slot, index: to.index }) }
        }
      }
      for (const t of line.points.targets) {
        follow(line.points.source, t)
        follow(t, line.points.source)
      }
    }
    // An empty's two sides represent the same sort — link them.
    const emp = d.empties.find((e) => e.id === ref.node)
    if (emp) {
      const otherSide: Side = ref.side === 'left' ? 'right' : 'left'
      if (emp.points[otherSide]) {
        const k = key({ node: emp.id, side: otherSide, index: 0 })
        if (!visited.has(k)) { visited.add(k); queue.push({ node: emp.id, side: otherSide, index: 0 }) }
      }
    }
  }

  const hit = (node: string, s: NodeSide, sl: Slot | undefined, i: number) => visited.has(key({ node, side: s, slot: sl, index: i }))
  const rename = (pts: DiagramPoint[], node: string, s: NodeSide, sl?: Slot) =>
    pts.map((p, i) => hit(node, s, sl, i) ? { ...p, name: label } : p)

  const renameRhombusSide = (sd: { down: DiagramPoint[]; center?: DiagramPoint; up: DiagramPoint[] }, node: string, s: Side) => ({
    down: rename(sd.down, node, s, 'down'),
    ...(sd.center ? { center: hit(node, s, 'center', 0) ? { ...sd.center, name: label } : sd.center } : {}),
    up: rename(sd.up, node, s, 'up'),
  })

  const renameRectSide = (sd: { down?: DiagramPoint; center: DiagramPoint[]; up?: DiagramPoint }, node: string, s: Side) => ({
    ...(sd.down ? { down: hit(node, s, 'down', 0) ? { ...sd.down, name: label } : sd.down } : {}),
    center: rename(sd.center, node, s, 'center'),
    ...(sd.up ? { up: hit(node, s, 'up', 0) ? { ...sd.up, name: label } : sd.up } : {}),
  })

  const renameCenterCol = (
    cc: { down?: DiagramPoint; center?: DiagramPoint; up?: DiagramPoint },
    node: string,
  ) => ({
    ...(cc.down ? { down: hit(node, 'center', 'down', 0) ? { ...cc.down, name: label } : cc.down } : {}),
    ...(cc.center ? { center: hit(node, 'center', 'center', 0) ? { ...cc.center, name: label } : cc.center } : {}),
    ...(cc.up ? { up: hit(node, 'center', 'up', 0) ? { ...cc.up, name: label } : cc.up } : {}),
  })

  const renameEmptyNode = (e: DiagramEmpty): DiagramEmpty => {
    const pts: DiagramEmpty['points'] = {}
    if (e.points.left) pts.left = hit(e.id, 'left', undefined, 0) ? { ...e.points.left, name: label } : e.points.left
    if (e.points.right) pts.right = hit(e.id, 'right', undefined, 0) ? { ...e.points.right, name: label } : e.points.right
    return { ...e, points: pts }
  }

  return {
    ...d,
    empties: d.empties.map(renameEmptyNode),
    triangles: d.triangles.map((t) => ({
      ...t,
      points: {
        left: rename(t.points.left, t.id, 'left'),
        right: rename(t.points.right, t.id, 'right'),
        ...(t.points.center ? { center: hit(t.id, 'center', undefined, 0) ? { ...t.points.center, name: label } : t.points.center } : {}),
        total: hit(t.id, 'total', undefined, 0) ? { ...t.points.total, name: label } : t.points.total,
      },
    })),
    rectangles: d.rectangles.map((r) => ({ ...r, points: {
      left: renameRectSide(r.points.left, r.id, 'left'),
      right: renameRectSide(r.points.right, r.id, 'right'),
      center: renameCenterCol(r.points.center, r.id),
      down: rename(r.points.down, r.id, 'down'),
      up: rename(r.points.up, r.id, 'up'),
      total: hit(r.id, 'total', undefined, 0) ? { ...r.points.total, name: label } : r.points.total,
    } })),
    circles: d.circles.map((c) => ({ ...c, points: {
      left: rename(c.points.left, c.id, 'left'),
      right: rename(c.points.right, c.id, 'right'),
      up: rename(c.points.up, c.id, 'up'),
      down: rename(c.points.down, c.id, 'down'),
      center: renameCenterCol(c.points.center, c.id),
      total: hit(c.id, 'total', undefined, 0) ? { ...c.points.total, name: label } : c.points.total,
    } })),
    rhombuses: d.rhombuses.map((r) => ({
      ...r,
      points: {
        left: renameRhombusSide(r.points.left, r.id, 'left'),
        right: renameRhombusSide(r.points.right, r.id, 'right'),
        center: renameCenterCol(r.points.center, r.id),
        ...(r.points.up ? { up: hit(r.id, 'up', undefined, 0) ? { ...r.points.up, name: label } : r.points.up } : {}),
        ...(r.points.down ? { down: hit(r.id, 'down', undefined, 0) ? { ...r.points.down, name: label } : r.points.down } : {}),
        total: hit(r.id, 'total', undefined, 0) ? { ...r.points.total, name: label } : r.points.total,
      },
    })),
    lines: d.lines.map((l) => {
      let src = l.points.source
      const srcHit = src.node && src.side && src.index !== undefined && hit(src.node, src.side, src.slot, src.index)
      if (srcHit) src = { ...src, name: label }
      const targets = l.points.targets.map((t) => {
        const h = t.node && t.side && t.index !== undefined && hit(t.node, t.side, t.slot, t.index)
        return h ? { ...t, name: label } : t
      })
      return { ...l, points: { source: src, targets } }
    }),
  }
}

// ===== Lines =====

export function addLine(d: DiagramData, source: DiagramPoint, target: DiagramPoint): [DiagramData, string] {
  const n = nextName('L', d.lines.map((l) => l.id))
  const withLine: DiagramData = { ...d, lines: [...d.lines, { id: n, points: { source, targets: [target] } }] }
  // Enforce: all connected points share the same sort. Propagate source.name through the component.
  const unified = source.node && source.side !== undefined && source.index !== undefined
    ? setPointLabel(withLine, source.node, source.side, source.index, source.name, source.slot)
    : withLine
  return [unified, n]
}

// Append a new target to an existing line (branching). Propagates the source sort to the new target.
export function addLineTarget(d: DiagramData, lineName: string, target: DiagramPoint): DiagramData {
  const line = d.lines.find((l) => l.id === lineName)
  if (!line) return d
  const withTarget: DiagramData = {
    ...d,
    lines: d.lines.map((l) => l.id !== lineName ? l : { ...l, points: { source: l.points.source, targets: [...l.points.targets, target] } }),
  }
  const s = line.points.source
  return s.node && s.side !== undefined && s.index !== undefined
    ? setPointLabel(withTarget, s.node, s.side, s.index, s.name, s.slot)
    : withTarget
}

// Delete one branch of a line; if it was the last branch, delete the whole line.
export function deleteLineTarget(d: DiagramData, lineName: string, index: number): DiagramData {
  const line = d.lines.find((l) => l.id === lineName)
  if (!line) return d
  if (line.points.targets.length <= 1) {
    return { ...d, lines: d.lines.filter((l) => l.id !== lineName) }
  }
  return {
    ...d,
    lines: d.lines.map((l) => l.id !== lineName ? l : { ...l, points: { source: l.points.source, targets: l.points.targets.filter((_, i) => i !== index) } }),
  }
}

export function deleteLine(d: DiagramData, name: string): DiagramData {
  return { ...d, lines: d.lines.filter((l) => l.id !== name) }
}

export function renameLine(d: DiagramData, oldName: string, newName: string): [DiagramData, boolean] {
  if (oldName === newName) return [d, true]
  if (!newName) return [d, false]
  if (d.lines.some((l) => l.id === newName)) return [d, false]
  return [{ ...d, lines: d.lines.map((l) => l.id === oldName ? { ...l, id: newName } : l) }, true]
}

// Create an empty carrier + a line anchoring one end to the carrier and the other to the given point.
// freeRole = 'source' → carrier hosts the line's source (input-var, right side).
// freeRole = 'target' → carrier hosts the line's target (output-var, left side).
export function addLineWithFreeEnd(
  d: DiagramData,
  anchor: DiagramPoint,
  freeRole: 'source' | 'target',
  emptyPosition: XY,
): [DiagramData, { emptyName: string; lineName: string }] {
  const emptySide: Side = freeRole === 'source' ? 'right' : 'left'
  const [d1, emptyName] = addEmpty(d, emptyPosition, emptySide, anchor.name)
  const emptyRef: DiagramPoint = { name: anchor.name, node: emptyName, side: emptySide, index: 0 }
  const [source, target] = freeRole === 'source' ? [emptyRef, anchor] : [anchor, emptyRef]
  const [d2, lineName] = addLine(d1, source, target)
  return [d2, { emptyName, lineName }]
}

// ===== Empties =====

export function addEmpty(d: DiagramData, position: XY, side?: Side, label?: string, name?: string): [DiagramData, string] {
  const n = name?.trim() || nextName('E', allNodeNames(d))
  if (d.empties.some((e) => e.id === n)) return [d, n]
  let points: DiagramEmpty['points'] = {}
  if (side) {
    const pt: DiagramPoint = { name: label ?? nextName('P', allPointNames(d)) }
    points = side === 'left' ? { left: pt } : { right: pt }
  }
  return [{ ...d, empties: [...d.empties, { id: n, position, points }] }, n]
}

export function deleteEmpty(d: DiagramData, name: string): DiagramData {
  return { ...d, empties: d.empties.filter((e) => e.id !== name), lines: removeNodeLines(d, name) }
}

export function renameEmpty(d: DiagramData, oldName: string, newName: string): [DiagramData, boolean] {
  if (oldName === newName) return [d, true]
  if (!newName) return [d, false]
  if (allNodeNames(d).includes(newName)) return [d, false]
  return [{
    ...d,
    empties: d.empties.map((e) => e.id === oldName ? { ...e, id: newName } : e),
    lines: updateLineRefs(d, oldName, newName),
  }, true]
}

// ===== Triangles =====

export function addTriangle(d: DiagramData, position: XY, name?: string): [DiagramData, string] {
  const n = name?.trim() || nextName('T', allNodeNames(d))
  if (d.triangles.some((t) => t.id === n)) return [d, n]
  return [{ ...d, triangles: [...d.triangles, { id: n, position, points: { left: [], right: [], total: { name: n } } }] }, n]
}

export function deleteTriangle(d: DiagramData, name: string): DiagramData {
  return { ...d, triangles: d.triangles.filter((t) => t.id !== name), lines: removeNodeLines(d, name) }
}

export function renameTriangle(d: DiagramData, oldName: string, newName: string): [DiagramData, boolean] {
  if (oldName === newName) return [d, true]
  if (!newName) return [d, false]
  if (allNodeNames(d).includes(newName)) return [d, false]
  return [{
    ...d,
    triangles: d.triangles.map((t) => t.id === oldName ? { ...t, id: newName } : t),
    lines: updateLineRefs(d, oldName, newName),
  }, true]
}

// ===== Rectangles =====

export function addRectangle(d: DiagramData, position: XY, name?: string): [DiagramData, string] {
  const n = name?.trim() || nextName('R', allNodeNames(d))
  if (d.rectangles.some((r) => r.id === n)) return [d, n]
  return [{ ...d, rectangles: [...d.rectangles, { id: n, position, points: {
    left:  { center: [] },
    right: { center: [] },
    center: {},
    down: [],
    up: [],
    total: { name: n },
  } }] }, n]
}

export function deleteRectangle(d: DiagramData, name: string): DiagramData {
  return { ...d, rectangles: d.rectangles.filter((r) => r.id !== name), lines: removeNodeLines(d, name) }
}

export function renameRectangle(d: DiagramData, oldName: string, newName: string): [DiagramData, boolean] {
  if (oldName === newName) return [d, true]
  if (!newName) return [d, false]
  if (allNodeNames(d).includes(newName)) return [d, false]
  return [{
    ...d,
    rectangles: d.rectangles.map((r) => r.id === oldName ? { ...r, id: newName } : r),
    lines: updateLineRefs(d, oldName, newName),
  }, true]
}

// ===== Circles =====

export function addCircle(d: DiagramData, position: XY, name?: string): [DiagramData, string] {
  const n = name?.trim() || nextName('C', allNodeNames(d))
  if (d.circles.some((c) => c.id === n)) return [d, n]
  return [{ ...d, circles: [...d.circles, { id: n, position, points: { left: [], right: [], up: [], down: [], center: {}, total: { name: n } } }] }, n]
}

export function deleteCircle(d: DiagramData, name: string): DiagramData {
  return { ...d, circles: d.circles.filter((c) => c.id !== name), lines: removeNodeLines(d, name) }
}

export function renameCircle(d: DiagramData, oldName: string, newName: string): [DiagramData, boolean] {
  if (oldName === newName) return [d, true]
  if (!newName) return [d, false]
  if (allNodeNames(d).includes(newName)) return [d, false]
  return [{
    ...d,
    circles: d.circles.map((c) => c.id === oldName ? { ...c, id: newName } : c),
    lines: updateLineRefs(d, oldName, newName),
  }, true]
}

// ===== Rhombuses =====

export function addRhombus(d: DiagramData, position: XY, name?: string): [DiagramData, string] {
  const n = name?.trim() || nextName('D', allNodeNames(d))
  if (d.rhombuses.some((r) => r.id === n)) return [d, n]
  return [{ ...d, rhombuses: [...d.rhombuses, { id: n, position, points: {
    left:  { down: [], up: [] },
    right: { down: [], up: [] },
    center: {},
    total: { name: n },
  } }] }, n]
}

export function deleteRhombus(d: DiagramData, name: string): DiagramData {
  return { ...d, rhombuses: d.rhombuses.filter((r) => r.id !== name), lines: removeNodeLines(d, name) }
}

export function renameRhombus(d: DiagramData, oldName: string, newName: string): [DiagramData, boolean] {
  if (oldName === newName) return [d, true]
  if (!newName) return [d, false]
  if (allNodeNames(d).includes(newName)) return [d, false]
  return [{
    ...d,
    rhombuses: d.rhombuses.map((r) => r.id === oldName ? { ...r, id: newName } : r),
    lines: updateLineRefs(d, oldName, newName),
  }, true]
}
