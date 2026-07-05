import type { Diagram } from './types'

// Role-prefixed numbered ids: forms F1.., points P1.., lines L1..
function nextNumberedId(taken: Iterable<string>, prefix: string): string {
  const re = new RegExp(`^${prefix}(\\d+)$`)
  let max = 0
  for (const id of taken) {
    const m = id.match(re)
    if (m) {
      const n = parseInt(m[1], 10)
      if (n > max) max = n
    }
  }
  return `${prefix}${max + 1}`
}

export function newFormId(d: Diagram): string {
  return nextNumberedId(d.forms.map((f) => f.id), 'F')
}

export function newPointId(d: Diagram): string {
  return nextNumberedId(Object.keys(d.points), 'P')
}

export function newLineId(d: Diagram): string {
  return nextNumberedId(d.lines.map((l) => l.id), 'L')
}
