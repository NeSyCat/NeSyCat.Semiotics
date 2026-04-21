import type {
  DiagramData,
  DiagramEmpty,
  DiagramTriangle,
  DiagramRectangle,
  DiagramCircle,
  DiagramRhombus,
  DiagramLine,
  DiagramPoint,
} from '@/components/editor/types'

// The bundled sample JSONs (CSG, DatabaseVorlesung2, aristotLOGIK) predate the
// current DiagramData shape: they use `name` where the live editor uses `id`,
// and rectangles/triangles/circles ship sparse `points` (bare arrays on left/right)
// instead of the slotted structure the renderer expects. Normalize on read so the
// readonly embed can mount them without editor-side changes.
//
// This is forgiving: anything missing is defaulted to empty; anything already in
// canonical form is passed through untouched.

type AnyObj = Record<string, unknown>

function idFrom(obj: AnyObj): string {
  return (obj.id as string) ?? (obj.name as string) ?? ''
}

function position(obj: AnyObj): { x: number; y: number } {
  const p = obj.position as AnyObj | undefined
  return { x: Number(p?.x ?? 0), y: Number(p?.y ?? 0) }
}

function normalizePoint(pt: AnyObj | undefined): DiagramPoint | undefined {
  if (!pt) return undefined
  return {
    name: String(pt.name ?? ''),
    ...(pt.node ? { node: String(pt.node) } : {}),
    ...(pt.side ? { side: pt.side as DiagramPoint['side'] } : {}),
    ...(pt.slot ? { slot: pt.slot as DiagramPoint['slot'] } : {}),
    ...(pt.index != null ? { index: Number(pt.index) } : {}),
  }
}

function normalizePointArray(arr: unknown): DiagramPoint[] {
  if (!Array.isArray(arr)) return []
  return arr.map((p) => normalizePoint(p as AnyObj)).filter((p): p is DiagramPoint => !!p)
}

function normalizeEmpty(raw: AnyObj): DiagramEmpty {
  const id = idFrom(raw)
  const pts = (raw.points as AnyObj) ?? {}
  return {
    id,
    position: position(raw),
    points: {
      ...(pts.left ? { left: normalizePoint(pts.left as AnyObj)! } : {}),
      ...(pts.right ? { right: normalizePoint(pts.right as AnyObj)! } : {}),
    },
  }
}

function normalizeTriangle(raw: AnyObj): DiagramTriangle {
  const id = idFrom(raw)
  const pts = (raw.points as AnyObj) ?? {}
  return {
    id,
    position: position(raw),
    points: {
      left: normalizePointArray(pts.left),
      right: normalizePointArray(pts.right),
      ...(pts.center ? { center: normalizePoint(pts.center as AnyObj)! } : {}),
      total: normalizePoint(pts.total as AnyObj) ?? { name: id },
    },
  }
}

// Rectangle in legacy bundle: points.left/right are bare arrays. Canonical: { down?, center: [], up? }.
function rectSide(s: unknown): { down?: DiagramPoint; center: DiagramPoint[]; up?: DiagramPoint } {
  if (Array.isArray(s)) return { center: normalizePointArray(s) }
  const obj = (s as AnyObj) ?? {}
  return {
    ...(obj.down ? { down: normalizePoint(obj.down as AnyObj)! } : {}),
    center: normalizePointArray(obj.center),
    ...(obj.up ? { up: normalizePoint(obj.up as AnyObj)! } : {}),
  }
}

function normalizeRectangle(raw: AnyObj): DiagramRectangle {
  const id = idFrom(raw)
  const pts = (raw.points as AnyObj) ?? {}
  const center = (pts.center as AnyObj) ?? {}
  return {
    id,
    position: position(raw),
    points: {
      left: rectSide(pts.left),
      right: rectSide(pts.right),
      center: {
        ...(center.down ? { down: normalizePoint(center.down as AnyObj)! } : {}),
        ...(center.center ? { center: normalizePoint(center.center as AnyObj)! } : {}),
        ...(center.up ? { up: normalizePoint(center.up as AnyObj)! } : {}),
      },
      down: normalizePointArray(pts.down),
      up: normalizePointArray(pts.up),
      total: normalizePoint(pts.total as AnyObj) ?? { name: id },
    },
  }
}

function normalizeCircle(raw: AnyObj): DiagramCircle {
  const id = idFrom(raw)
  const pts = (raw.points as AnyObj) ?? {}
  const center = (pts.center as AnyObj) ?? {}
  return {
    id,
    position: position(raw),
    points: {
      left: normalizePointArray(pts.left),
      right: normalizePointArray(pts.right),
      up: normalizePointArray(pts.up),
      down: normalizePointArray(pts.down),
      center: {
        ...(center.down ? { down: normalizePoint(center.down as AnyObj)! } : {}),
        ...(center.center ? { center: normalizePoint(center.center as AnyObj)! } : {}),
        ...(center.up ? { up: normalizePoint(center.up as AnyObj)! } : {}),
      },
      total: normalizePoint(pts.total as AnyObj) ?? { name: id },
    },
  }
}

function rhombusSide(s: unknown): { down: DiagramPoint[]; center?: DiagramPoint; up: DiagramPoint[] } {
  const obj = (s as AnyObj) ?? {}
  return {
    down: normalizePointArray(obj.down),
    ...(obj.center ? { center: normalizePoint(obj.center as AnyObj)! } : {}),
    up: normalizePointArray(obj.up),
  }
}

function normalizeRhombus(raw: AnyObj): DiagramRhombus {
  const id = idFrom(raw)
  const pts = (raw.points as AnyObj) ?? {}
  const center = (pts.center as AnyObj) ?? {}
  return {
    id,
    position: position(raw),
    points: {
      left: rhombusSide(pts.left),
      right: rhombusSide(pts.right),
      center: {
        ...(center.down ? { down: normalizePoint(center.down as AnyObj)! } : {}),
        ...(center.center ? { center: normalizePoint(center.center as AnyObj)! } : {}),
        ...(center.up ? { up: normalizePoint(center.up as AnyObj)! } : {}),
      },
      ...(pts.down ? { down: normalizePoint(pts.down as AnyObj)! } : {}),
      ...(pts.up ? { up: normalizePoint(pts.up as AnyObj)! } : {}),
      total: normalizePoint(pts.total as AnyObj) ?? { name: id },
    },
  }
}

function normalizeLine(raw: AnyObj): DiagramLine {
  const id = idFrom(raw)
  const pts = (raw.points as AnyObj) ?? {}
  const source = normalizePoint(pts.source as AnyObj) ?? { name: '' }
  const targets = Array.isArray(pts.targets)
    ? (pts.targets as AnyObj[]).map((t) => normalizePoint(t)!).filter(Boolean)
    : []
  return { id, points: { source, targets } }
}

export function normalizeSample(raw: unknown): DiagramData {
  const r = (raw as AnyObj) ?? {}
  return {
    empties: Array.isArray(r.empties) ? (r.empties as AnyObj[]).map(normalizeEmpty) : [],
    triangles: Array.isArray(r.triangles) ? (r.triangles as AnyObj[]).map(normalizeTriangle) : [],
    rectangles: Array.isArray(r.rectangles) ? (r.rectangles as AnyObj[]).map(normalizeRectangle) : [],
    circles: Array.isArray(r.circles) ? (r.circles as AnyObj[]).map(normalizeCircle) : [],
    rhombuses: Array.isArray(r.rhombuses) ? (r.rhombuses as AnyObj[]).map(normalizeRhombus) : [],
    lines: Array.isArray(r.lines) ? (r.lines as AnyObj[]).map(normalizeLine) : [],
  }
}
