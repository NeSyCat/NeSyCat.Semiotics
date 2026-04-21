// ===== Abstract diagram types — geometric primitives (a priori) =====

export interface XY { x: number; y: number }

export interface DiagramEmpty {
  id: string
  position: XY
  points: {
    left?: DiagramPoint
    right?: DiagramPoint
  }
}

export interface DiagramPoint {
  name: string
  node?: string           // rectangle, triangle, or circle id (absent if free)
  side?: 'left' | 'right' | 'center' | 'down' | 'up' | 'total'
  slot?: 'down' | 'center' | 'up'  // rhombus + rectangle side slots
  index?: number
}

export interface DiagramLine {
  id: string
  points: { source: DiagramPoint; targets: DiagramPoint[] }
}

export interface DiagramTriangle {
  id: string
  position: XY
  points: { 
    left: DiagramPoint[] 
    right: DiagramPoint[] 
    center?: DiagramPoint 
    total: DiagramPoint }
}

export interface DiagramRhombus {
  id: string
  position: XY
  points: {
    left:  { down: DiagramPoint[]; center?: DiagramPoint; up: DiagramPoint[] }
    right: { down: DiagramPoint[]; center?: DiagramPoint; up: DiagramPoint[] }
    center: { down?: DiagramPoint; center?: DiagramPoint; up?: DiagramPoint }
    down?: DiagramPoint
    up?: DiagramPoint
    total: DiagramPoint
  }
}

export interface DiagramCircle {
  id: string
  position: XY
  points: {
    left: DiagramPoint[]
    right: DiagramPoint[]
    up: DiagramPoint[]
    down: DiagramPoint[]
    center: { down?: DiagramPoint; center?: DiagramPoint; up?: DiagramPoint }
    total: DiagramPoint
  }
}

export interface DiagramRectangle {
  id: string
  position: XY
  points: {
    left:  { down?: DiagramPoint; center: DiagramPoint[]; up?: DiagramPoint }
    right: { down?: DiagramPoint; center: DiagramPoint[]; up?: DiagramPoint }
    center: { down?: DiagramPoint; center?: DiagramPoint; up?: DiagramPoint }
    down: DiagramPoint[]
    up: DiagramPoint[]
    total: DiagramPoint
  }
}

export interface DiagramData {
  empties: DiagramEmpty[]
  lines: DiagramLine[]
  triangles: DiagramTriangle[]
  rhombuses: DiagramRhombus[]
  circles: DiagramCircle[]
  rectangles: DiagramRectangle[]
}
