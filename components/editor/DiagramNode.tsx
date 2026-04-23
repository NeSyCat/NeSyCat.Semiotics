import { memo, useMemo, useState, useRef, useEffect } from 'react'
import { Handle, Position, useReactFlow } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import theme, { glassBlur, pointDotStyle, selectionGlow } from './style/theme'
import type { DiagramPoint } from './types'
import { useStore } from './store'

type NodeKind = 'empty' | 'triangle' | 'rectangle' | 'circle' | 'rhombus'
type Side = 'left' | 'right'
type NodeSide = 'left' | 'right' | 'center' | 'down' | 'up' | 'total'
type Slot = 'down' | 'center' | 'up'

type RhombusSlots = { down: DiagramPoint[]; center?: DiagramPoint; up: DiagramPoint[] }
type RectSideSlots = { down?: DiagramPoint; center: DiagramPoint[]; up?: DiagramPoint }
type CenterColumn = { down?: DiagramPoint; center?: DiagramPoint; up?: DiagramPoint }
type RectanglePoints = {
  left: RectSideSlots
  right: RectSideSlots
  center: CenterColumn
  down: DiagramPoint[]
  up: DiagramPoint[]
}

interface NodeData {
  kind: NodeKind
  label: string
  accent: string
  points: { left: DiagramPoint[]; right: DiagramPoint[]; up?: DiagramPoint[]; down?: DiagramPoint[] }
  centerPoint?: DiagramPoint        // triangle, circle
  centerColumn?: CenterColumn       // rectangle, rhombus
  rhombusPoints?: { left: RhombusSlots; right: RhombusSlots; up?: DiagramPoint; down?: DiagramPoint }
  rectanglePoints?: RectanglePoints
  totalPoint?: DiagramPoint         // triangle, rectangle, circle, rhombus (absent for empty)
  onAddPoint?: (side: NodeSide, slot?: Slot) => void
  onSetPointLabel?: (nodeName: string, side: NodeSide, index: number, label: string, slot?: Slot) => void
  onRename?: (name: string) => boolean
}

type EditTarget =
  | { kind: 'point'; pointName: string }

const BASE_SIZE = 200
const ROW_HEIGHT = 48
const LABEL_PAD = 2       // gap between handle dot and label text (all shapes)

// Bipolar handle: renders target + source at the same id so any point can act
// as either end of a connection.
//
// React Flow computes edge endpoints on the handle's Position-specific
// bounding-rect edge, which puts a 12×12 dot's endpoint 6px off its visual
// center. To keep the endpoint on the dot's exact center we split the two:
// a hidden 1×1 Handle pair at the anchor, with a visible 12×12 dot rendered
// as a child so pointer events bubble naturally and drag-to-connect fires on
// the handle (not node-drag).
function BiHandle({ id, position, style, className }: {
  id: string
  position: Position
  style: React.CSSProperties
  className?: string
}) {
  const {
    top, left, right, bottom, transform,
    width: _w, height: _h, minWidth: _mw, minHeight: _mh, position: _p,
    ...visual
  } = style
  void _w; void _h; void _mw; void _mh; void _p

  // Hidden 1×1 handle at the anchor. React Flow's .react-flow__handle-<pos>
  // class supplies top/left/right/bottom/transform defaults; we override only
  // the axes the caller actually specified.
  const handleStyle: React.CSSProperties = {
    ...(top       !== undefined && { top }),
    ...(left      !== undefined && { left }),
    ...(right     !== undefined && { right }),
    ...(bottom    !== undefined && { bottom }),
    ...(transform !== undefined && { transform }),
    width: 1, height: 1, minWidth: 1, minHeight: 1,
    background: 'transparent',
    border: 'none',
    padding: 0,
    overflow: 'visible',
    cursor: 'crosshair',
    // Sit above point labels (zIndex 1) so drag-to-connect on the dot isn't
    // masked by the label's hit box when the two overlap.
    zIndex: 3,
  }

  // Visible 12×12 dot, centered on its 1×1 parent.
  const dotStyle: React.CSSProperties = {
    ...visual,
    position: 'absolute',
    top: '50%', left: '50%',
    transform: 'translate(-50%, -50%)',
    width: 12, height: 12,
    borderRadius: '50%',
  }

  // Dot lives inside the SOURCE handle so drag-from-dot starts as a source
  // drag — the resulting edge's direction then matches the user's drag (A→B,
  // not B→A).
  //
  // Source is rendered AFTER target so it paints on top in DOM order. Both
  // handles are 1×1 at the same center, so they overlap at the one center
  // pixel; whichever is painted later wins pointerdown there. Putting source
  // last ensures that every click on the dot (including its exact center)
  // starts a source-drag, avoiding intermittent direction flips.
  return (
    <>
      <Handle key={`${id}-t`} type="target" position={position} id={id} style={handleStyle} className={className} />
      <Handle key={`${id}-s`} type="source" position={position} id={id} style={handleStyle} className={className}>
        <div style={dotStyle} />
      </Handle>
    </>
  )
}

// Triangle geometry: equilateral inscribed in circumscribed circle, pointing right
// Circumradius = BASE_SIZE / 2 = 50
// Vertices relative to BASE_SIZE x BASE_SIZE bounding box:
const TRI_LEFT_X_FRAC = 0.25    // BASE_SIZE / 4
const TRI_TOP_Y_FRAC = 0.5 - Math.sqrt(3) / 4   // ~0.067
const TRI_BOT_Y_FRAC = 0.5 + Math.sqrt(3) / 4   // ~0.933

// Closed rounded polygon path — each corner replaced by a quadratic Bézier arc.
function roundedPath(points: [number, number][], radius: number): string {
  const n = points.length
  if (n < 3) return ''
  let d = ''
  for (let i = 0; i < n; i++) {
    const p0 = points[(i - 1 + n) % n]
    const p1 = points[i]
    const p2 = points[(i + 1) % n]
    const v0x = p0[0] - p1[0], v0y = p0[1] - p1[1]
    const v2x = p2[0] - p1[0], v2y = p2[1] - p1[1]
    const l0 = Math.hypot(v0x, v0y)
    const l2 = Math.hypot(v2x, v2y)
    const r = Math.min(radius, l0 / 2, l2 / 2)
    const ax = p1[0] + (v0x / l0) * r
    const ay = p1[1] + (v0y / l0) * r
    const bx = p1[0] + (v2x / l2) * r
    const by = p1[1] + (v2y / l2) * r
    d += i === 0 ? `M ${ax},${ay}` : ` L ${ax},${ay}`
    d += ` Q ${p1[0]},${p1[1]} ${bx},${by}`
  }
  return d + ' Z'
}

// Abstract glow wrapper — uses the shared selectionGlow for all shapes.
// will-change: filter promotes the inner layer to its own GPU layer so the
// glow animation doesn't trigger repaints on sibling elements.
//
// The glow filter is nested inside a clip container sized exactly to the 2×
// selection frame (see renderSelectionFrame) with a shape-matching clip, so
// the halo ends hard at the frame border instead of bleeding past it.
function GlowWrap({ selected, accent, shape, width, height, children }: {
  selected: boolean
  accent: string
  shape: 'rectangle' | 'triangle' | 'circle' | 'rhombus'
  width: number
  height: number
  children: React.ReactNode
}) {
  const frameOffset = width / 2   // matches renderSelectionFrame: 2× scale about center
  const frameCorner = 10          // matches renderSelectionFrame's rectangle border-radius

  let clipShape: React.CSSProperties = {}
  if (shape === 'rectangle') {
    clipShape = { borderRadius: frameCorner }
  } else if (shape === 'circle') {
    clipShape = { borderRadius: '50%' }
  } else if (shape === 'rhombus') {
    // 2× rhombus: tips at mid-edges of the 2× box.
    clipShape = { clipPath: 'polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)' }
  } else {
    // Triangle: 2×-scaled about the base triangle's centroid. The scaled
    // vertices, expressed as % of the 2× box, are (lx%, ty%), (100%, 50%),
    // (lx%, by%), where lx/ty/by are the base triangle's fractional coords.
    const lxp = (TRI_LEFT_X_FRAC * 100).toFixed(2) + '%'
    const typ = (TRI_TOP_Y_FRAC * 100).toFixed(2) + '%'
    const byp = (TRI_BOT_Y_FRAC * 100).toFixed(2) + '%'
    clipShape = { clipPath: `polygon(${lxp} ${typ}, 100% 50%, ${lxp} ${byp})` }
  }

  return (
    <div style={{
      position: 'absolute',
      left: -frameOffset,
      top: -frameOffset,
      width: width + 2 * frameOffset,
      height: height + 2 * frameOffset,
      pointerEvents: 'none',
      overflow: 'hidden',
      ...clipShape,
    }}>
      <div style={{
        position: 'absolute',
        left: frameOffset,
        top: frameOffset,
        width,
        height,
        willChange: 'filter',
        transition: 'filter 0.15s ease',
        ...selectionGlow(accent, selected),
      }}>
        {children}
      </div>
    </div>
  )
}

// Shape-specific fill + border (no glow logic — GlowWrap handles that)
function ShapeFill({ shape, accent, fillOpacity, borderOpacity, width, height }: {
  shape: 'rectangle' | 'triangle' | 'circle' | 'rhombus'
  accent: string
  fillOpacity: number
  borderOpacity: number
  width: number
  height: number
}) {
  const bg = `rgba(${accent}, ${fillOpacity})`
  const borderColor = `rgba(${accent}, ${borderOpacity})`

  if (shape === 'triangle') {
    const lx = width * TRI_LEFT_X_FRAC
    const ty = height * TRI_TOP_Y_FRAC
    const by = height * TRI_BOT_Y_FRAC
    const clipPath = `polygon(${lx}px ${ty}px, ${width}px ${height / 2}px, ${lx}px ${by}px)`
    return (
      <>
        <div style={{
          position: 'absolute', inset: 0,
          clipPath,
          background: bg,
          ...glassBlur(),
          transition: 'background 0.15s ease',
        }} />
        <svg
          width={width} height={height}
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
        >
          <polygon
            points={`${lx},${ty} ${width},${height / 2} ${lx},${by}`}
            fill="none"
            stroke={borderColor}
            strokeWidth={1}
          />
        </svg>
      </>
    )
  }

  if (shape === 'rhombus') {
    const mx = width / 2
    const my = height / 2
    const clipPath = `polygon(${mx}px 0, ${width}px ${my}px, ${mx}px ${height}px, 0 ${my}px)`
    return (
      <>
        <div style={{
          position: 'absolute', inset: 0,
          clipPath,
          background: bg,
          ...glassBlur(),
          transition: 'background 0.15s ease',
        }} />
        <svg
          width={width} height={height}
          style={{ position: 'absolute', top: 0, left: 0, overflow: 'visible' }}
        >
          <polygon
            points={`${mx},0 ${width},${my} ${mx},${height} 0,${my}`}
            fill="none"
            stroke={borderColor}
            strokeWidth={1}
          />
        </svg>
      </>
    )
  }

  // circle and rectangle share the same structure, only borderRadius differs
  return (
    <div style={{
      position: 'absolute', inset: 0,
      borderRadius: shape === 'circle' ? '50%' : 0,
      background: bg,
      outline: `1px solid ${borderColor}`,
      outlineOffset: -0.5,
      ...glassBlur(),
      transition: 'background 0.15s ease, outline-color 0.15s ease',
    }} />
  )
}

// Composed background: GlowWrap + ShapeFill
function NodeBg(props: {
  shape: 'rectangle' | 'triangle' | 'circle' | 'rhombus'
  accent: string
  fillOpacity: number
  borderOpacity: number
  selected: boolean
  width: number
  height: number
}) {
  return (
    <GlowWrap
      selected={props.selected}
      accent={props.accent}
      shape={props.shape}
      width={props.width}
      height={props.height}
    >
      <ShapeFill
        shape={props.shape}
        accent={props.accent}
        fillOpacity={props.fillOpacity}
        borderOpacity={props.borderOpacity}
        width={props.width}
        height={props.height}
      />
    </GlowWrap>
  )
}

function DiagramNode({ id, data, selected }: NodeProps) {
  const d = data as unknown as NodeData
  const isEmpty = d.kind === 'empty'
  const isTriangle = d.kind === 'triangle'
  const isCircle = d.kind === 'circle'
  const isRhombus = d.kind === 'rhombus'
  const isRectangle = d.kind === 'rectangle'
  const { setNodes, setEdges } = useReactFlow()

  // Only tracks THIS node's selected points. Returns a stable string so Zustand's
  // Object.is comparison means this node only re-renders when its OWN selection changes.
  const selectedContainers = useStore((s) => {
    const prefix = `${id}|`
    return s.selectedPoints
      .filter((p) => p.container.startsWith(prefix))
      .map((p) => p.container)
      .join(',')
  })

  const setSelectedPoints = useStore((s) => s.setSelectedPoints)
  const toggleSelectedPoint = useStore((s) => s.toggleSelectedPoint)
  const pointsVisible = useStore((s) => s.visibility.points)

  const isPointSelected = (handleId: string) =>
    selectedContainers.includes(`${id}|${handleId}`)

  const effectiveSelected = selected

  const [editTarget, setEditTarget] = useState<EditTarget | null>(null)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (editTarget && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editTarget])

  function startEdit(target: EditTarget, currentValue: string) {
    setEditTarget(target)
    setEditText(currentValue)
  }

  function confirmEdit() {
    if (!editTarget) return
    const text = editText.trim()
    if (editTarget.kind === 'point') {
      if (text) {
        const parts = editTarget.pointName.split('|')
        if (parts.length === 4) {
          d.onSetPointLabel?.(parts[0], parts[1] as NodeSide, parseInt(parts[3]), text, parts[2] as Slot)
        } else {
          d.onSetPointLabel?.(parts[0], parts[1] as NodeSide, parseInt(parts[2]), text)
        }
      }
    }
    setEditTarget(null)
  }

  function cancelEdit() {
    setEditTarget(null)
  }

  const fillOpacity = effectiveSelected ? theme.node.selectedFillOpacity : theme.node.fillOpacity
  const borderOpacity = effectiveSelected ? theme.node.selectedBorderOpacity : theme.node.borderOpacity

  // nodeSize: minimum BASE_SIZE, grows only when uniform spacing between points
  // (including corners) would drop below ROW_HEIGHT.
  let nodeSize: number
  if (isEmpty) {
    nodeSize = BASE_SIZE / 4
  } else if (isRhombus && d.rhombusPoints) {
    const lp = d.rhombusPoints.left
    const rp = d.rhombusPoints.right
    const maxK = Math.max(lp.up.length, lp.down.length, rp.up.length, rp.down.length, 0)
    // Half-edge x-span nodeSize/2 divided into (maxK+1) intervals, each ≥ ROW_HEIGHT/2.
    nodeSize = Math.max(BASE_SIZE, (maxK + 1) * ROW_HEIGHT)
  } else if (isRectangle && d.rectanglePoints) {
    const rp = d.rectanglePoints
    const maxN = Math.max(rp.left.center.length, rp.right.center.length, rp.up.length, rp.down.length, 0)
    // Edge length nodeSize divided into (maxN+1) intervals, each ≥ ROW_HEIGHT.
    nodeSize = Math.max(BASE_SIZE, (maxN + 1) * ROW_HEIGHT)
  } else {
    const maxSlots = Math.max(d.points.left.length, d.points.right.length, 0)
    nodeSize = Math.max(BASE_SIZE, (maxSlots + 1) * ROW_HEIGHT)
  }
  const nodeWidth = nodeSize
  const nodeHeight = nodeSize

  // Uniform spacing along a vertical edge, treating the box top/bottom as anchors:
  // k points land at (i+1)/(k+1) * nodeSize. Single point → midpoint.
  const sideTop = (count: number, i: number) =>
    (i + 1) * nodeSize / (count + 1)

  // Triangle left-edge bounds (for handle positioning)
  const triLeftX = nodeSize * TRI_LEFT_X_FRAC
  const triTopY = nodeSize * TRI_TOP_Y_FRAC
  const triBotY = nodeSize * TRI_BOT_Y_FRAC
  const triEdgeHeight = triBotY - triTopY

  function renderPointLabel(pt: DiagramPoint, side: NodeSide, index: number, slot?: Slot, styleOverride?: React.CSSProperties) {
    const encodedKey = slot ? `${id}|${side}|${slot}|${index}` : `${id}|${side}|${index}`
    const handleId = slot ? `${side}-${slot}-${index}` : `${side}-${index}`
    const pointEditing =
      editTarget?.kind === 'point' &&
      editTarget.pointName === encodedKey

    const isSelected = isPointSelected(handleId)

    // Both span and input share the exact same typography & box so editing doesn't
    // jolt the label's size or position.
    const baseStyle: React.CSSProperties = {
      fontSize: theme.smallFontSize,
      fontWeight: 500,
      color: isSelected ? theme.text.primary : theme.text.secondary,
      fontFamily: "'SF Mono', Menlo, monospace",
      background: isSelected ? `rgba(${d.accent}, 0.25)` : 'transparent',
      border: isSelected
        ? `1px solid rgba(${d.accent}, 0.7)`
        : '1px solid transparent',
      borderRadius: 3,
      padding: '1px 5px',
      boxSizing: 'border-box',
      lineHeight: 1.3,
      ...styleOverride,
    }

    if (pointEditing) {
      return (
        <input
          ref={inputRef}
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmEdit()
            if (e.key === 'Escape') cancelEdit()
          }}
          onBlur={confirmEdit}
          size={Math.max(1, editText.length)}
          style={{
            ...baseStyle,
            outline: 'none',
            textAlign: side === 'right' ? 'right' : side === 'left' ? 'left' : 'center',
          }}
        />
      )
    }

    return (
      <span
        className={side === 'total' ? 'point-label total-label' : 'point-label'}
        onClick={(e) => {
          e.stopPropagation()
          const sel = { pointName: pt.name, container: `${id}|${handleId}` }
          if (e.metaKey || e.ctrlKey) {
            toggleSelectedPoint(sel)
          } else {
            setSelectedPoints([sel], true)
            setNodes((ns) => ns.map((n) => n.selected ? { ...n, selected: false } : n))
            setEdges((es) => es.map((edge) => edge.selected ? { ...edge, selected: false } : edge))
          }
        }}
        onDoubleClick={(e) => {
          e.stopPropagation()
          startEdit({ kind: 'point', pointName: encodedKey }, pt.name)
        }}
        style={{
          ...baseStyle,
          cursor: 'text',
          userSelect: 'none',
          transition: 'background 0.1s, border-color 0.1s',
        }}
      >
        {pt.name}
      </span>
    )
  }

  const totalFontStyle: React.CSSProperties = {
    fontSize: theme.fontSize,
    fontWeight: 600,
    color: theme.text.primary,
    textShadow: theme.text.shadow,
    fontFamily: 'inherit',
    lineHeight: 1.3,
    whiteSpace: 'nowrap',
    background: 'transparent',
    border: '1px solid transparent',
  }

  function renderTotalBlock() {
    if (!d.totalPoint) return null
    // Dot sits on the 2× outline at the "upper-left" direction (225° from the shape
    // center). Each shape resolves this to the exact point where that ray meets its
    // outline:
    //  - rect / empty: upper-left corner of the 2× box
    //  - circle:       same angle (45° above-left) on the 2× circle perimeter
    //  - rhombus:      intersection of the 225° ray with the 2× rhombus edge = (0, 0)
    //  - triangle:     the 2×-scaled top-left vertex (already on the 225° side)
    //
    // When points are hidden, the total dot + label collapse to the shape's
    // geometric center so only one anchor point is visible per shape.
    let cx: number, cy: number
    if (!pointsVisible) {
      cx = nodeSize / 2
      cy = nodeSize / 2
    } else if (isTriangle) {
      cx = 2 * nodeSize * TRI_LEFT_X_FRAC - nodeSize / 2             // = 0 for default
      cy = 2 * nodeSize * TRI_TOP_Y_FRAC - nodeSize / 2              // ≈ -0.366 * nodeSize
    } else if (isCircle) {
      const center = nodeSize / 2
      const r = nodeSize      // 2× radius
      cx = center - r / Math.SQRT2
      cy = center - r / Math.SQRT2
    } else if (isRhombus) {
      cx = 0
      cy = 0
    } else {
      // rectangle / empty: upper-left corner of the 2× outline
      cx = -frameOffset
      cy = -frameOffset
    }
    return (
      <>
        <div style={{
          position: 'absolute',
          left: cx,
          bottom: nodeSize - cy + LABEL_PAD,     // label sits just above the dot
          transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          whiteSpace: 'nowrap', overflow: 'visible', zIndex: 2,
        }}>
          {renderPointLabel(d.totalPoint, 'total', 0, undefined, totalFontStyle)}
        </div>
        <BiHandle
          position={Position.Top}
          id="total-0"
          className="total-handle"
          style={{ ...pointDotStyle(d.accent, isPointSelected('total-0')), top: cy, left: cx, right: 'auto', bottom: 'auto' }}
        />
      </>
    )
  }

  // Outline frame is exactly 2× the shape, scaled about the shape's center.
  // For rect/empty/circle/rhombus that places the top at y = -nodeSize/2, so the
  // total-point dot at (nodeSize/2, -nodeSize/2) lies on the outline.
  const frameOffset = nodeSize / 2
  const frameStroke = `rgba(${d.accent}, 0.6)`
  const frameStrokeWidth = 1.5
  const frameCorner = 10

  function renderSelectionFrame() {
    if (isEmpty) return null
    // When points are hidden the total collapses to shape center, so the 2×
    // outline frame (which is what the total anchor sits on) is hidden too.
    if (!pointsVisible) return null
    if (isRectangle || isCircle) {
      return (
        <div style={{
          position: 'absolute',
          left: -frameOffset,
          top: -frameOffset,
          width: nodeSize + 2 * frameOffset,
          height: nodeSize + 2 * frameOffset,
          border: `${frameStrokeWidth}px solid ${frameStroke}`,
          borderRadius: isCircle ? '50%' : 10,
          pointerEvents: 'none',
          zIndex: 0,
          boxSizing: 'border-box',
        }} />
      )
    }
    if (isRhombus) {
      const mx = nodeSize / 2
      const my = nodeSize / 2
      const pts: [number, number][] = [
        [mx, -frameOffset],
        [nodeSize + frameOffset, my],
        [mx, nodeSize + frameOffset],
        [-frameOffset, my],
      ]
      return (
        <svg
          width={nodeSize} height={nodeSize}
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}
        >
          <path
            d={roundedPath(pts, frameCorner)}
            fill="none"
            stroke={frameStroke}
            strokeWidth={frameStrokeWidth}
          />
        </svg>
      )
    }
    if (isTriangle) {
      // Triangle vertices scaled 2× about the centroid (which, for this inscribed
      // equilateral triangle, sits at (nodeSize/2, nodeSize/2)).
      const c = nodeSize / 2
      const scale2 = (x: number, y: number): [number, number] => [2 * x - c, 2 * y - c]
      const lx = nodeSize * TRI_LEFT_X_FRAC
      const ty = nodeSize * TRI_TOP_Y_FRAC
      const by = nodeSize * TRI_BOT_Y_FRAC
      const pts: [number, number][] = [
        scale2(lx, ty),
        scale2(nodeSize, nodeSize / 2),
        scale2(lx, by),
      ]
      return (
        <svg
          width={nodeSize} height={nodeSize}
          style={{ position: 'absolute', inset: 0, overflow: 'visible', pointerEvents: 'none', zIndex: 0 }}
        >
          <path
            d={roundedPath(pts, frameCorner)}
            fill="none"
            stroke={frameStroke}
            strokeWidth={frameStrokeWidth}
          />
        </svg>
      )
    }
    return null
  }

  // Left handles — positioned along the shape's left edge
  const leftHandles = useMemo(() =>
    d.points.left.map((_pt, i) => {
      const n = d.points.left.length
      let top: number
      let leftPos: number | undefined
      if (isTriangle) {
        top = triTopY + (i + 1) * triEdgeHeight / (n + 1)
        leftPos = triLeftX
      } else {
        top = sideTop(n, i)
      }
      return (
        <BiHandle
          key={`left-${i}`}
          position={Position.Left}
          id={`left-${i}`}
          style={{
            ...pointDotStyle(d.accent, isPointSelected(`left-${i}`)),
            top,
            ...(leftPos !== undefined ? { left: leftPos } : {}),
          }}
        />
      )
    }),
    [d.points.left, d.accent, selectedContainers, isTriangle, isEmpty, triTopY, triEdgeHeight, triLeftX, nodeSize]
  )

  // Right handles
  const rightHandles = useMemo(() => {
    const n = d.points.right.length
    return d.points.right.map((_pt, i) => (
      <BiHandle
        key={`right-${i}`}
        position={Position.Right}
        id={`right-${i}`}
        style={{
          ...pointDotStyle(d.accent, isPointSelected(`right-${i}`)),
          top: isTriangle ? nodeSize / 2 : sideTop(n, i),
        }}
      />
    ))
  }, [d.points.right, d.accent, selectedContainers, isTriangle, isEmpty, nodeSize])

  // Rhombus handles — uniform spacing along each half-edge, counting the rhombus
  // corners (top / left-middle / right-middle / bottom) as the edge anchors.
  // up[i] at parameter t = (i+1)/(k+1) from the middle-tip toward the top corner;
  // down[i] at t = (i+1)/(k+1) from the middle-tip toward the bottom corner.
  const rhombusHandles = useMemo(() => {
    if (!isRhombus || !d.rhombusPoints) return null
    const handles: React.ReactNode[] = []
    const half = nodeSize / 2

    if (d.rhombusPoints.up) {
      handles.push(
        <BiHandle key="up-0" position={Position.Top} id="up-0"
          style={{ ...pointDotStyle(d.accent, isPointSelected('up-0')), top: 0, left: half, right: 'auto', bottom: 'auto' }} />
      )
    }
    if (d.rhombusPoints.down) {
      handles.push(
        <BiHandle key="down-0" position={Position.Bottom} id="down-0"
          style={{ ...pointDotStyle(d.accent, isPointSelected('down-0')), top: nodeSize, left: half, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }} />
      )
    }

    for (const side of ['left', 'right'] as const) {
      const s = d.rhombusPoints[side]
      const pos = side === 'left' ? Position.Left : Position.Right
      const edgeKey = side === 'left' ? 'left' : 'right'

      const kUp = s.up.length
      s.up.forEach((_, i) => {
        const t = (i + 1) / (kUp + 1)
        const edgeX = t * half         // distance from the side's axis edge (left or right)
        const y = (1 - t) * half       // distance from the top of the bounding box
        const hid = `${side}-up-${i}`
        handles.push(
          <BiHandle key={hid} position={pos} id={hid}
            style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), top: y, [edgeKey]: edgeX }} />
        )
      })

      if (s.center) {
        const cId = `${side}-center-0`
        handles.push(
          <BiHandle key={cId} position={pos} id={cId}
            style={{ ...pointDotStyle(d.accent, isPointSelected(cId)), top: half }} />
        )
      }

      const kDown = s.down.length
      s.down.forEach((_, i) => {
        const t = (i + 1) / (kDown + 1)
        const edgeX = t * half
        const y = half + t * half
        const hid = `${side}-down-${i}`
        handles.push(
          <BiHandle key={hid} position={pos} id={hid}
            style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), top: y, [edgeKey]: edgeX }} />
        )
      })
    }

    return handles
  }, [d.rhombusPoints, d.accent, selectedContainers, nodeSize, isRhombus])

  // Rectangle handles — left/right have down/center[]/up slots; top/bottom edges have stackable arrays
  const rectangleHandles = useMemo(() => {
    if (!isRectangle || !d.rectanglePoints) return null
    const rp = d.rectanglePoints
    const handles: React.ReactNode[] = []

    for (const side of ['left', 'right'] as const) {
      const s = rp[side]
      const pos = side === 'left' ? Position.Left : Position.Right
      // Corner up (at the actual top corner)
      if (s.up) {
        const hid = `${side}-up-0`
        handles.push(
          <BiHandle key={hid} position={pos} id={hid}
            style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), top: 0 }} />
        )
      }
      // Center stack — uniform spacing along [0, nodeSize]; corners count as the
      // endpoints, so center[i] lands at (i+1)/(k+1) of the edge from the top.
      const k = s.center.length
      s.center.forEach((_, i) => {
        const top = (i + 1) * nodeSize / (k + 1)
        const hid = `${side}-center-${i}`
        handles.push(
          <BiHandle key={hid} position={pos} id={hid}
            style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), top }} />
        )
      })
      // Corner down (at the actual bottom corner)
      if (s.down) {
        const hid = `${side}-down-0`
        handles.push(
          <BiHandle key={hid} position={pos} id={hid}
            style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), top: nodeSize }} />
        )
      }
    }

    // Top edge (up[]) — uniform spacing along [0, nodeSize] (left.up / right.up are the corners)
    const nUp = rp.up.length
    rp.up.forEach((_, i) => {
      const left = (i + 1) * nodeSize / (nUp + 1)
      const hid = `up-${i}`
      handles.push(
        <BiHandle key={hid} position={Position.Top} id={hid}
          style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), top: 0, left, right: 'auto', bottom: 'auto' }} />
      )
    })
    // Bottom edge (down[]) — override default .react-flow__handle-bottom transform
    // (which is translate(-50%, 50%)) so the dot centers on the border line.
    const nDown = rp.down.length
    rp.down.forEach((_, i) => {
      const left = (i + 1) * nodeSize / (nDown + 1)
      const hid = `down-${i}`
      handles.push(
        <BiHandle key={hid} position={Position.Bottom} id={hid}
          style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), top: nodeSize, left, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }} />
      )
    })

    return handles
  }, [d.rectanglePoints, d.accent, selectedContainers, nodeSize, isRectangle])

  // + buttons when the node is selected. Rectangle / rhombus / circle have their
  // own arc-aware plus-button sets; skip the generic ones. For empty: only on
  // sides that aren't already occupied.
  const showLeftPlus = effectiveSelected && !isRectangle && !isCircle && (!isEmpty || d.points.left.length === 0)
  const triangleRightFull = isTriangle && d.points.right.length > 0
  const showRightPlus = effectiveSelected && !isRectangle && !isCircle && !triangleRightFull && (!isEmpty || d.points.right.length === 0)
  const plusButtons = (showLeftPlus || showRightPlus) && (
    <>
      {showLeftPlus && (
        <button
          onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('left') }}
          style={plusBtnStyle('left')}
          title="Add left point"
        >
          <PlusIcon />
        </button>
      )}
      {showRightPlus && (
        <button
          onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('right') }}
          style={plusBtnStyle('right')}
          title="Add right point"
        >
          <PlusIcon />
        </button>
      )}
    </>
  )

  // Shape for background
  const shapeKind: 'rectangle' | 'triangle' | 'circle' | 'rhombus' =
    isCircle ? 'circle' : isTriangle ? 'triangle' : isRhombus ? 'rhombus' : 'rectangle'

  const bg = isEmpty ? null : (
    <NodeBg
      shape={shapeKind}
      accent={d.accent}
      fillOpacity={fillOpacity}
      borderOpacity={borderOpacity}
      selected={effectiveSelected}
      width={nodeWidth}
      height={nodeHeight}
    />
  )

  const showLeftLabels = !isTriangle
  const showRightLabels = !isTriangle

  // Shared center block:
  // - triangle / circle: single-point at (nodeSize/2, nodeSize/4) — legacy behavior.
  // - rectangle / rhombus: 3-slot column { up @ nodeSize/4, center @ nodeSize/2, down @ 3·nodeSize/4 }.
  //   All slots are optional; each empty slot shows a plus button when the node is selected.
  const centerBlock = (() => {
    const cx = nodeSize / 2

    if (d.centerColumn) {
      const col = d.centerColumn
      const slots: Array<{ pt: DiagramPoint | undefined; slot: Slot; cy: number }> = [
        { pt: col.up,     slot: 'up',     cy: nodeSize / 4 },
        { pt: col.center, slot: 'center', cy: nodeSize / 2 },
        { pt: col.down,   slot: 'down',   cy: 3 * nodeSize / 4 },
      ]
      return (
        <>
          {slots.map(({ pt, slot, cy }) => {
            const handleId = `center-${slot}-0`
            if (pt) {
              return (
                <div key={handleId}>
                  <div style={{
                    position: 'absolute', left: cx, top: cy - 4,
                    transform: 'translate(-50%, -100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    whiteSpace: 'nowrap', overflow: 'visible', zIndex: 3,
                  }}>
                    {renderPointLabel(pt, 'center', 0, slot)}
                  </div>
                  <BiHandle
                    position={Position.Top}
                    id={handleId}
                    style={{ ...pointDotStyle(d.accent, isPointSelected(handleId)), top: cy, left: cx, right: 'auto', bottom: 'auto' }}
                  />
                </div>
              )
            }
            if (!effectiveSelected) return null
            return (
              <button
                key={handleId}
                onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('center', slot) }}
                title={`Add center-${slot} point`}
                style={{
                  position: 'absolute', left: cx, top: cy,
                  transform: 'translate(-50%, -50%)',
                  width: 28, height: 28, borderRadius: '50%',
                  border: '1px solid rgba(255,255,255,0.15)',
                  background: 'rgba(255,255,255,0.3)',
                  color: 'rgba(255,255,255,0.7)',
                  cursor: 'pointer', padding: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxSizing: 'border-box', zIndex: 3,
                }}
              >
                <PlusIcon />
              </button>
            )
          })}
        </>
      )
    }

    // Triangle / circle: legacy single-center at nodeSize/4
    const cy = nodeSize / 4
    if (d.centerPoint) {
      return (
        <>
          <div style={{
            position: 'absolute', left: cx, top: cy - 4,
            transform: 'translate(-50%, -100%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            maxWidth: 80, overflow: 'visible', zIndex: 3,
          }}>
            {renderPointLabel(d.centerPoint, 'center', 0)}
          </div>
          <BiHandle
            position={Position.Top}
            id="center-0"
            style={{ ...pointDotStyle(d.accent, isPointSelected('center-0')), top: cy, left: cx, right: 'auto', bottom: 'auto' }}
          />
        </>
      )
    }
    return null
  })()

  // ----- Triangle layout -----
  if (isTriangle) {
    return (
      <div
        style={{ position: 'relative', width: nodeWidth, height: nodeHeight, cursor: 'pointer' }}
      >
        {renderSelectionFrame()}
        {bg}
        {renderTotalBlock()}
        {/* Left point labels — external (left of triangle's left edge) */}
        {d.points.left.map((pt, i) => {
          const n = d.points.left.length
          const top = triTopY + (i + 1) * triEdgeHeight / (n + 1) - ROW_HEIGHT / 2
          return (
            <div key={`l-${i}`} style={{
              position: 'absolute', right: nodeSize - triLeftX + LABEL_PAD,
              top, height: ROW_HEIGHT,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'left', i)}
            </div>
          )
        })}
        {/* Right point label (τ at tip) — external */}
        {d.points.right.map((pt, i) => (
          <div key={`r-${i}`} style={{
            position: 'absolute', left: nodeSize + LABEL_PAD,
            top: nodeSize / 2 - ROW_HEIGHT / 2,
            height: ROW_HEIGHT,
            display: 'flex', alignItems: 'center',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(pt, 'right', i)}
          </div>
        ))}
        {leftHandles}
        {rightHandles}
        {plusButtons}
        {centerBlock}
      </div>
    )
  }

  // ----- Rhombus layout -----
  if (isRhombus && d.rhombusPoints) {
    const lp = d.rhombusPoints.left
    const rp = d.rhombusPoints.right
    const topCorner = d.rhombusPoints.up
    const botCorner = d.rhombusPoints.down

    return (
      <div
        style={{ position: 'relative', width: nodeWidth, height: nodeHeight, cursor: 'pointer' }}
      >
        {renderSelectionFrame()}
        {bg}
        {renderTotalBlock()}

        {/* Top corner label — external above top tip */}
        {topCorner && (
          <div style={{
            position: 'absolute',
            left: nodeSize / 2,
            bottom: nodeSize + LABEL_PAD,
            transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(topCorner, 'up', 0)}
          </div>
        )}

        {/* Bottom corner label — external below bottom tip */}
        {botCorner && (
          <div style={{
            position: 'absolute',
            left: nodeSize / 2,
            top: nodeSize + LABEL_PAD,
            transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(botCorner, 'down', 0)}
          </div>
        )}

        {/* Left up labels — external (outside rhombus edge) */}
        {lp.up.map((pt, i) => {
          const k = lp.up.length
          const t = (i + 1) / (k + 1)
          const edgeX = t * nodeSize / 2
          const y = (1 - t) * nodeSize / 2
          return (
            <div key={`lu-${i}`} style={{
              position: 'absolute', right: nodeSize - edgeX + LABEL_PAD,
              top: y - ROW_HEIGHT / 2,
              height: ROW_HEIGHT,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'left', i, 'up')}
            </div>
          )
        })}

        {/* Left center label — external left */}
        {lp.center && (
          <div style={{
            position: 'absolute', right: nodeSize + LABEL_PAD,
            top: nodeSize / 2 - ROW_HEIGHT / 2,
            height: ROW_HEIGHT,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(lp.center, 'left', 0, 'center')}
          </div>
        )}

        {/* Left down labels — external (outside rhombus edge) */}
        {lp.down.map((pt, i) => {
          const k = lp.down.length
          const t = (i + 1) / (k + 1)
          const edgeX = t * nodeSize / 2
          const y = nodeSize / 2 + t * nodeSize / 2
          return (
            <div key={`ld-${i}`} style={{
              position: 'absolute', right: nodeSize - edgeX + LABEL_PAD,
              top: y - ROW_HEIGHT / 2,
              height: ROW_HEIGHT,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'left', i, 'down')}
            </div>
          )
        })}

        {/* Right up labels — external */}
        {rp.up.map((pt, i) => {
          const k = rp.up.length
          const t = (i + 1) / (k + 1)
          const edgeX = t * nodeSize / 2   // distance from right edge of bounding box
          const y = (1 - t) * nodeSize / 2
          return (
            <div key={`ru-${i}`} style={{
              position: 'absolute', left: nodeSize - edgeX + LABEL_PAD,
              top: y - ROW_HEIGHT / 2,
              height: ROW_HEIGHT,
              display: 'flex', alignItems: 'center',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'right', i, 'up')}
            </div>
          )
        })}

        {/* Right center label (τ) — external right */}
        {rp.center && (
          <div style={{
            position: 'absolute', left: nodeSize + LABEL_PAD,
            top: nodeSize / 2 - ROW_HEIGHT / 2,
            height: ROW_HEIGHT,
            display: 'flex', alignItems: 'center',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(rp.center, 'right', 0, 'center')}
          </div>
        )}

        {/* Right down labels — external */}
        {rp.down.map((pt, i) => {
          const k = rp.down.length
          const t = (i + 1) / (k + 1)
          const edgeX = t * nodeSize / 2
          const y = nodeSize / 2 + t * nodeSize / 2
          return (
            <div key={`rd-${i}`} style={{
              position: 'absolute', left: nodeSize - edgeX + LABEL_PAD,
              top: y - ROW_HEIGHT / 2,
              height: ROW_HEIGHT,
              display: 'flex', alignItems: 'center',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'right', i, 'down')}
            </div>
          )
        })}

        {rhombusHandles}
        {centerBlock}

        {/* Plus buttons: up / center / down on both sides — positioned outside each half-edge midpoint */}
        {effectiveSelected && (() => {
          const pbBase: React.CSSProperties = { position: 'absolute', width: 32, height: 32, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', transform: 'translate(-50%, -50%)' }
          // Slide plus off the midpoint only when a stack of 1 puts a point there; k=0 or k≥2 → midpoint.
          const half = nodeSize / 2
          const tUp = (k: number) => k === 1 ? 3 / 4 : 1 / 2
          const tDown = (k: number) => k === 1 ? 1 / 4 : 1 / 2
          const tLU = tUp(lp.up.length)
          const tRU = tUp(rp.up.length)
          const tLD = tDown(lp.down.length)
          const tRD = tDown(rp.down.length)
          return (
            <>
              <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('left', 'up') }}
                style={{ ...pbBase, left: tLU * half, top: (1 - tLU) * half }} title="Add left-up point">
                <PlusIcon />
              </button>
              {!lp.center && (
                <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('left', 'center') }}
                  style={{ ...pbBase, left: 0, top: nodeSize / 2 }} title="Add left-center point">
                  <PlusIcon />
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('left', 'down') }}
                style={{ ...pbBase, left: tLD * half, top: half + tLD * half }} title="Add left-down point">
                <PlusIcon />
              </button>
              <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('right', 'up') }}
                style={{ ...pbBase, left: nodeSize - tRU * half, top: (1 - tRU) * half }} title="Add right-up point">
                <PlusIcon />
              </button>
              {!rp.center && (
                <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('right', 'center') }}
                  style={{ ...pbBase, left: nodeSize, top: nodeSize / 2 }} title="Add right-center point">
                  <PlusIcon />
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('right', 'down') }}
                style={{ ...pbBase, left: nodeSize - tRD * half, top: half + tRD * half }} title="Add right-down point">
                <PlusIcon />
              </button>
              {!topCorner && (
                <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('up') }}
                  style={{ ...pbBase, left: nodeSize / 2, top: 0 }} title="Add top corner point">
                  <PlusIcon />
                </button>
              )}
              {!botCorner && (
                <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('down') }}
                  style={{ ...pbBase, left: nodeSize / 2, top: nodeSize }} title="Add bottom corner point">
                  <PlusIcon />
                </button>
              )}
            </>
          )
        })()}
      </div>
    )
  }

  // ----- Rectangle layout (slot-aware, 9 plus buttons) -----
  if (isRectangle && d.rectanglePoints) {
    const rp = d.rectanglePoints
    const lp = rp.left
    const rpS = rp.right

    return (
      <div
        style={{ position: 'relative', width: nodeWidth, height: nodeHeight, cursor: 'pointer' }}
      >
        {renderSelectionFrame()}
        {bg}
        {renderTotalBlock()}

        {/* Left up corner — external */}
        {lp.up && (
          <div style={{
            position: 'absolute', right: nodeSize + LABEL_PAD,
            top: -ROW_HEIGHT / 2,
            height: ROW_HEIGHT,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(lp.up, 'left', 0, 'up')}
          </div>
        )}
        {/* Left center stack — external (uniform spacing between corners) */}
        {lp.center.map((pt, i) => {
          const k = lp.center.length
          return (
            <div key={`lc-${i}`} style={{
              position: 'absolute', right: nodeSize + LABEL_PAD,
              top: (i + 1) * nodeSize / (k + 1) - ROW_HEIGHT / 2,
              height: ROW_HEIGHT,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'left', i, 'center')}
            </div>
          )
        })}
        {/* Left down corner — external */}
        {lp.down && (
          <div style={{
            position: 'absolute', right: nodeSize + LABEL_PAD,
            top: nodeSize - ROW_HEIGHT / 2,
            height: ROW_HEIGHT,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(lp.down, 'left', 0, 'down')}
          </div>
        )}

        {/* Right up corner — external */}
        {rpS.up && (
          <div style={{
            position: 'absolute', left: nodeSize + LABEL_PAD,
            top: -ROW_HEIGHT / 2,
            height: ROW_HEIGHT,
            display: 'flex', alignItems: 'center',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(rpS.up, 'right', 0, 'up')}
          </div>
        )}
        {/* Right center stack — external (uniform spacing between corners) */}
        {rpS.center.map((pt, i) => {
          const k = rpS.center.length
          return (
            <div key={`rc-${i}`} style={{
              position: 'absolute', left: nodeSize + LABEL_PAD,
              top: (i + 1) * nodeSize / (k + 1) - ROW_HEIGHT / 2,
              height: ROW_HEIGHT,
              display: 'flex', alignItems: 'center',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'right', i, 'center')}
            </div>
          )
        })}
        {/* Right down corner — external */}
        {rpS.down && (
          <div style={{
            position: 'absolute', left: nodeSize + LABEL_PAD,
            top: nodeSize - ROW_HEIGHT / 2,
            height: ROW_HEIGHT,
            display: 'flex', alignItems: 'center',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(rpS.down, 'right', 0, 'down')}
          </div>
        )}

        {/* Top edge up[] labels — external above (uniform spacing between corners) */}
        {rp.up.map((pt, i) => {
          const k = rp.up.length
          const leftX = (i + 1) * nodeSize / (k + 1)
          return (
            <div key={`tu-${i}`} style={{
              position: 'absolute',
              left: leftX,
              bottom: nodeSize + LABEL_PAD,
              transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'up', i)}
            </div>
          )
        })}
        {/* Bottom edge down[] labels — external below (uniform spacing between corners) */}
        {rp.down.map((pt, i) => {
          const k = rp.down.length
          const leftX = (i + 1) * nodeSize / (k + 1)
          return (
            <div key={`bd-${i}`} style={{
              position: 'absolute',
              left: leftX,
              top: nodeSize + LABEL_PAD,
              transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'down', i)}
            </div>
          )
        })}

        {rectangleHandles}
        {centerBlock}

        {/* 9 plus buttons: left/right × (up/center/down) + top-edge + bottom-edge + shape-center */}
        {effectiveSelected && (() => {
          const pbBase: React.CSSProperties = { position: 'absolute', width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', transform: 'translate(-50%, -50%)', zIndex: 4 }
          // Slide plus off the midpoint only when it would overlap a point (stack of 1 puts a
          // point at the midpoint). For k=0 or k≥2, the midpoint is free, so return there.
          const near = (n: number) => n === 1 ? nodeSize / 4 : nodeSize / 2
          const lcT = near(lp.center.length)
          const rcT = near(rpS.center.length)
          const upL = rp.up.length === 1 ? 3 * nodeSize / 4 : nodeSize / 2
          const downL = rp.down.length === 1 ? 3 * nodeSize / 4 : nodeSize / 2
          return (
            <>
              {!lp.up && (
                <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('left', 'up') }}
                  style={{ ...pbBase, left: 0, top: 0 }} title="Add left-up corner point">
                  <PlusIcon />
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('left', 'center') }}
                style={{ ...pbBase, left: 0, top: lcT }} title="Add left-center point">
                <PlusIcon />
              </button>
              {!lp.down && (
                <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('left', 'down') }}
                  style={{ ...pbBase, left: 0, top: nodeSize }} title="Add left-down corner point">
                  <PlusIcon />
                </button>
              )}
              {!rpS.up && (
                <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('right', 'up') }}
                  style={{ ...pbBase, left: nodeSize, top: 0 }} title="Add right-up corner point">
                  <PlusIcon />
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('right', 'center') }}
                style={{ ...pbBase, left: nodeSize, top: rcT }} title="Add right-center point">
                <PlusIcon />
              </button>
              {!rpS.down && (
                <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('right', 'down') }}
                  style={{ ...pbBase, left: nodeSize, top: nodeSize }} title="Add right-down corner point">
                  <PlusIcon />
                </button>
              )}
              <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('up') }}
                style={{ ...pbBase, left: upL, top: 0 }} title="Add top-edge point">
                <PlusIcon />
              </button>
              <button onClick={(e) => { e.stopPropagation(); d.onAddPoint?.('down') }}
                style={{ ...pbBase, left: downL, top: nodeSize }} title="Add bottom-edge point">
                <PlusIcon />
              </button>
            </>
          )
        })()}
      </div>
    )
  }

  // ----- Circle layout: arc-aware handles, labels, plus buttons -----
  if (isCircle) {
    const r = nodeSize / 2
    const cx = nodeSize / 2
    const cy = nodeSize / 2
    // Four 90° arcs meeting at NW/NE/SE/SW corners (±π/4, ±3π/4).
    // Each arc is parameterized by t ∈ [0,1] between its two corner endpoints.
    const arcAngle = (arc: 'up' | 'down' | 'left' | 'right', t: number): number => {
      if (arc === 'up')    return 3 * Math.PI / 4 - t * Math.PI / 2   // NW → NE via N
      if (arc === 'down')  return 5 * Math.PI / 4 + t * Math.PI / 2   // SW → SE via S
      if (arc === 'left')  return 3 * Math.PI / 4 + t * Math.PI / 2   // NW → SW via W
      return Math.PI / 4 - t * Math.PI / 2                            // NE → SE via E
    }
    const arcPt = (arc: 'up' | 'down' | 'left' | 'right', t: number): [number, number] => {
      const θ = arcAngle(arc, t)
      return [cx + r * Math.cos(θ), cy - r * Math.sin(θ)]
    }
    const upArr = d.points.up ?? []
    const downArr = d.points.down ?? []
    const leftArr = d.points.left
    const rightArr = d.points.right

    return (
      <div
        style={{ position: 'relative', width: nodeWidth, height: nodeHeight, cursor: 'pointer' }}
      >
        {renderSelectionFrame()}
        {bg}
        {renderTotalBlock()}

        {/* Left arc labels — external (west of the arc point) */}
        {leftArr.map((pt, i) => {
          const n = leftArr.length
          const [x, y] = arcPt('left', (i + 1) / (n + 1))
          return (
            <div key={`l-${i}`} style={{
              position: 'absolute',
              right: nodeSize - x + LABEL_PAD,
              top: y - ROW_HEIGHT / 2, height: ROW_HEIGHT,
              display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'left', i)}
            </div>
          )
        })}

        {/* Right arc labels — external (east of the arc point) */}
        {rightArr.map((pt, i) => {
          const n = rightArr.length
          const [x, y] = arcPt('right', (i + 1) / (n + 1))
          return (
            <div key={`r-${i}`} style={{
              position: 'absolute',
              left: x + LABEL_PAD,
              top: y - ROW_HEIGHT / 2, height: ROW_HEIGHT,
              display: 'flex', alignItems: 'center',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'right', i)}
            </div>
          )
        })}

        {/* Up arc labels — external (above arc point) */}
        {upArr.map((pt, i) => {
          const n = upArr.length
          const [x, y] = arcPt('up', (i + 1) / (n + 1))
          return (
            <div key={`tu-${i}`} style={{
              position: 'absolute',
              left: x, bottom: nodeSize - y + LABEL_PAD,
              transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'up', i)}
            </div>
          )
        })}

        {/* Down arc labels — external (below arc point) */}
        {downArr.map((pt, i) => {
          const n = downArr.length
          const [x, y] = arcPt('down', (i + 1) / (n + 1))
          return (
            <div key={`bd-${i}`} style={{
              position: 'absolute',
              left: x, top: y + LABEL_PAD,
              transform: 'translateX(-50%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
            }}>
              {renderPointLabel(pt, 'down', i)}
            </div>
          )
        })}

        {/* Arc handles — all centered on the arc via translate(-50%, -50%) */}
        {leftArr.map((_, i) => {
          const n = leftArr.length
          const [x, y] = arcPt('left', (i + 1) / (n + 1))
          const hid = `left-${i}`
          return (
            <BiHandle key={hid} position={Position.Left} id={hid}
              style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), left: x, top: y, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }} />
          )
        })}
        {rightArr.map((_, i) => {
          const n = rightArr.length
          const [x, y] = arcPt('right', (i + 1) / (n + 1))
          const hid = `right-${i}`
          return (
            <BiHandle key={hid} position={Position.Right} id={hid}
              style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), left: x, top: y, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }} />
          )
        })}
        {upArr.map((_, i) => {
          const n = upArr.length
          const [x, y] = arcPt('up', (i + 1) / (n + 1))
          const hid = `up-${i}`
          return (
            <BiHandle key={hid} position={Position.Top} id={hid}
              style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), left: x, top: y, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }} />
          )
        })}
        {downArr.map((_, i) => {
          const n = downArr.length
          const [x, y] = arcPt('down', (i + 1) / (n + 1))
          const hid = `down-${i}`
          return (
            <BiHandle key={hid} position={Position.Bottom} id={hid}
              style={{ ...pointDotStyle(d.accent, isPointSelected(hid)), left: x, top: y, right: 'auto', bottom: 'auto', transform: 'translate(-50%, -50%)' }} />
          )
        })}

        {/* Plus buttons on each arc. Midpoint when count≠1; when count=1 the plus
            slides clockwise of the existing point so it's consistent around the circle.
            up/right arcs have t increasing clockwise → t=3/4.
            left/down arcs have t increasing counter-clockwise → t=1/4. */}
        {effectiveSelected && (() => {
          const pbBase: React.CSSProperties = { position: 'absolute', width: 28, height: 28, borderRadius: '50%', border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)', color: 'rgba(255,255,255,0.5)', cursor: 'pointer', padding: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', transform: 'translate(-50%, -50%)', zIndex: 4 }
          const plusT = (arc: 'up' | 'down' | 'left' | 'right', k: number) => {
            if (k !== 1) return 1 / 2
            return (arc === 'up' || arc === 'right') ? 3 / 4 : 1 / 4
          }
          const arcs: Array<{ arc: 'up' | 'down' | 'left' | 'right'; count: number }> = [
            { arc: 'up',    count: upArr.length },
            { arc: 'down',  count: downArr.length },
            { arc: 'left',  count: leftArr.length },
            { arc: 'right', count: rightArr.length },
          ]
          return (
            <>
              {arcs.map(({ arc, count }) => {
                const [x, y] = arcPt(arc, plusT(arc, count))
                return (
                  <button key={`plus-${arc}`}
                    onClick={(e) => { e.stopPropagation(); d.onAddPoint?.(arc) }}
                    style={{ ...pbBase, left: x, top: y }}
                    title={`Add ${arc} point`}>
                    <PlusIcon />
                  </button>
                )
              })}
            </>
          )
        })()}

        {centerBlock}
      </div>
    )
  }

  // ----- Centered layout: Empty -----
  return (
    <div
      style={{ position: 'relative', width: nodeWidth, height: nodeHeight, cursor: 'pointer' }}
    >
      {renderSelectionFrame()}
      {bg}
      {renderTotalBlock()}

      {/* Left point labels — external */}
      {showLeftLabels && d.points.left.map((pt, i) => {
        const n = d.points.left.length
        return (
          <div key={`l-${i}`} style={{
            position: 'absolute', right: nodeSize + LABEL_PAD,
            top: sideTop(n, i) - ROW_HEIGHT / 2,
            height: ROW_HEIGHT,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(pt, 'left', i)}
          </div>
        )
      })}

      {/* Right point labels — external */}
      {showRightLabels && d.points.right.map((pt, i) => {
        const n = d.points.right.length
        return (
          <div key={`r-${i}`} style={{
            position: 'absolute', left: nodeSize + LABEL_PAD,
            top: sideTop(n, i) - ROW_HEIGHT / 2,
            height: ROW_HEIGHT,
            display: 'flex', alignItems: 'center',
            whiteSpace: 'nowrap', overflow: 'visible', zIndex: 1,
          }}>
            {renderPointLabel(pt, 'right', i)}
          </div>
        )
      })}

      {leftHandles}
      {rightHandles}
      {plusButtons}
      {centerBlock}
    </div>
  )
}

function PlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 8 8" fill="none">
      <path
        d="M4 1v6M1 4h6"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinecap="round"
      />
    </svg>
  )
}

function plusBtnStyle(side: 'left' | 'right'): React.CSSProperties {
  const base: React.CSSProperties = {
    position: 'absolute',
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '1px solid rgba(255,255,255,0.15)',
    background: 'rgba(255,255,255,0.06)',
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    padding: 0,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
  }
  if (side === 'left') return { ...base, left: -50, top: '50%', transform: 'translate(-50%, -50%)' }
  return { ...base, right: -50, top: '50%', transform: 'translate(50%, -50%)' }
}

export default memo(DiagramNode)
