'use client'

import { Handle, Position } from '@xyflow/react'
import theme from './theme'
import type { Anchor } from '../domain/forms'
import { POINT_SIZE } from '../domain/forms'
import { toRgbTriple } from '../domain/color'
import { Tex } from './Tex'
import type { Point, Shape } from '../domain/types'

const POINT_NAME_SIZE = 12 // points a little smaller than the form name
// A point's grab-pad size — doubles as its drag-region tint's diameter AND
// its glyph's rendered diameter (POINT_SIZE, domain/forms.ts), so a point's
// draggable area, hover circle, and visual glyph all coincide exactly.
const REGION_CORNER_SIZE = POINT_SIZE
// 1.5 CSS px (BodyView's own form-body border width), converted into the
// glyph's 24-unit sprite viewBox so the STROKE renders at the same physical
// width regardless of the glyph's own SVG scale factor (POINT_SIZE/24).
const GLYPH_STROKE_VB = 1.5 * (24 / POINT_SIZE)

// A point's glyph is drawn from the SAME sprite as the toolbar (see
// sprite.tsx's ToolbarSprite) — small, shared vocabulary with the form/Shape
// rail. 'square' uses kind-rectangle. Rendered EXACTLY like a miniature form
// body (see FormNode.tsx's BodyView): a 1.5px black outline around a
// TRANSPARENT interior — no color means genuinely see-through (canvas/grid
// visible). A colored point tints that interior the SAME rgba/opacity rule
// BodyView uses for a form's own fill — white is then a real, explicit tint
// choice like any other color, not a default. Deliberately does NOT fall
// back to the form's own accent when the point has no color of its own — a
// point sitting on a colored form must NOT read as tinted by that form's
// color unless the point itself was explicitly given one (own color only).
function PointGlyph({ shape, accent, isSelected }: { shape: Shape; accent: string | null; isSelected: boolean }) {
  if (shape === 'empty') return null // Empty = nothing rendered; the dashed circle is only the toolbar symbol
  const sym = shape === 'square' ? 'kind-rectangle' : `kind-${shape}`
  const fillOpacity = isSelected ? theme.node.selectedFillOpacity : theme.node.fillOpacity
  return (
    <svg width={POINT_SIZE} height={POINT_SIZE} viewBox="0 0 24 24" style={{ display: 'block' }}>
      {/* outline — always solid black, always drawn; fill "none" by default
          so an uncolored point is genuinely transparent (the canvas/form
          border shows through it, gapped separately around the glyph — see
          BodyView/LineEdge). */}
      <use href={`#${sym}`} fill="none" stroke="black" strokeWidth={GLYPH_STROKE_VB} strokeLinejoin="round" strokeLinecap="round" />
      {/* color tint — same translucent-over-transparent rule as a form's own
          BodyView fill; only rendered when a color actually applies. */}
      {accent && <use href={`#${sym}`} fill={`rgba(${accent}, ${fillOpacity})`} stroke="none" />}
    </svg>
  )
}

// One point's full visual: drag-region tint, glyph, drag/select handles, and
// name label (plus its canvas-coloured mask so wires don't strike through
// it) — everything FormNode's per-edge point loop renders for a single
// point. Props are exactly what that loop body reads per-point; the
// geometry loop itself (edgeKeys × pointIdsAt) stays in FormNode since it's
// shared setup, not per-point rendering.
export function PointVisual({ pid, pt, anchor, hid, isSelected, isHovered, formRotation, onSelect }: {
  pid: string
  pt: Point
  anchor: Anchor
  hid: string
  isSelected: boolean
  isHovered: boolean
  formRotation: number
  onSelect: (e: React.MouseEvent, pid: string) => void
}) {
  // Own color only — see PointGlyph's comment above for why this must NOT
  // fall back to the form's accent.
  const glyphAccent = pt.color ? toRgbTriple(pt.color) : null

  // The name label sits OUTSIDE the point, in its edge's outward direction
  // (apex point → right, left-edge point → left, etc.). Counter-rotate so
  // it stays upright/readable when the form is rotated — same billboard
  // trick as the form's own name label.
  const GAP = 11
  const counterRotate = ` rotate(${-formRotation}deg)`
  const lblPos: React.CSSProperties =
    anchor.position === Position.Left ? { left: anchor.x - GAP, top: anchor.y, transform: `translate(-100%, -50%)${counterRotate}` }
      : anchor.position === Position.Right ? { left: anchor.x + GAP, top: anchor.y, transform: `translate(0, -50%)${counterRotate}` }
        : anchor.position === Position.Top ? { left: anchor.x, top: anchor.y - GAP, transform: `translate(-50%, -100%)${counterRotate}` }
          : { left: anchor.x, top: anchor.y + GAP, transform: `translate(-50%, 0)${counterRotate}` }
  // Handles are 1px AT the glyph centre, so a line anchors dead-centre on the
  // point (RF pins a handle to its position-edge — a large handle offsets the
  // line). The source carries an ~18px transparent grab pad; its pointer
  // events bubble up to the handle, so the point is still easy to grab/drag.
  const dotStyle: React.CSSProperties = {
    position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
    width: 1, height: 1, minWidth: 1, minHeight: 1, background: 'transparent', border: 'none', padding: 0, zIndex: 5,
  }
  // A point's own drag-region hover always wins over the form's
  // region/center hover (decided centrally in Canvas.tsx's
  // nearestPointWithin) — a selected point gets the darker tint instead,
  // quiver's hover/select language, not the blue form-selection accent.
  const regionTint = isSelected ? theme.node.regionSelected : isHovered ? theme.node.regionHover : null

  return (
    <span>
      {/* drag-region tint — a consistent circle for ALL points (incl. empty) */}
      {regionTint && (
        <div style={{
          position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
          width: REGION_CORNER_SIZE, height: REGION_CORNER_SIZE, borderRadius: '50%', zIndex: 3, pointerEvents: 'none',
          background: regionTint,
        }} />
      )}
      {/* glyph: visual only, behind the handles */}
      <div style={{
        position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
        zIndex: 4, pointerEvents: 'none', lineHeight: 0,
      }}>
        <PointGlyph shape={pt.shape} accent={glyphAccent} isSelected={isSelected} />
      </div>
      {/* Once 'empty's middle point EXISTS, it behaves exactly like any
          other kind's point — default isConnectableStart, so it can
          both receive a dropped wire AND start a new one by dragging
          straight from it. (Explicitly setting isConnectableStart to
          false here also happened to give the Handle no
          `connectionindicator` class, which React Flow's own CSS ties
          `pointer-events` to — base.css defaults `.react-flow__handle`
          to `pointer-events: none` and only re-enables it via
          `.connectionindicator`/`.connectingfrom`. That silently ate
          plain clicks too, since they inherit pointer-events from this
          parent: the grab pad never received them, so they fell
          through to the form body underneath and selected the FORM
          instead of the point — the direct-click-doesn't-select bug.
          Only the form's BODY still can't spawn a wire/new point — see
          FormNode's phantom-skip, which is what makes plain node-drag
          reachable there at all.) */}
      <Handle type="target" position={anchor.position} id={hid} style={dotStyle} />
      <Handle type="source" position={anchor.position} id={hid} style={dotStyle} onClick={(e) => onSelect(e, pid)}>
        {/* grab pad — easy to grab; events bubble to the handle above */}
        <span style={{ position: 'absolute', left: '50%', top: '50%', transform: 'translate(-50%, -50%)', width: REGION_CORNER_SIZE, height: REGION_CORNER_SIZE, borderRadius: '50%', cursor: 'crosshair', display: 'block' }} />
      </Handle>
      {/* point name — click it to select the point too; hidden via .points-hidden
          (see globals.css) when the Points toggle is off. data-point-id lets
          Canvas.tsx's onNodeMouseMove recognize a real hover here directly
          from the DOM event target — the label's rendered width varies with
          the name text, so a fixed proximity radius around the anchor alone
          can't reliably reach it. */}
      {/* Canvas-coloured mask so wires don't strike through the name — same
          idea as the line label's mask (LineEdge.tsx). A SEPARATE inert
          sibling at zIndex 0: above the edges layer (masks the wire) but
          below every tint overlay (zIndex 1+), so form hover/selection
          states sweep straight across the name instead of being notched.
          It positions/sizes itself with a hidden copy of the label text;
          the actual fill is an INSET band, tighter than KaTeX's tall line
          box, so the mask doesn't blank the wire farther out than the
          glyphs themselves. */}
      <div
        className="point-label"
        aria-hidden="true"
        style={{ position: 'absolute', ...lblPos, zIndex: 0, pointerEvents: 'none' }}
      >
        <span style={{ visibility: 'hidden' }}>
          <Tex fontSize={POINT_NAME_SIZE} color={theme.text.ink}>{pt.name ?? pid}</Tex>
        </span>
        <span style={{
          position: 'absolute', left: -2, right: -2, top: '15%', bottom: '15%',
          background: theme.canvas.background, borderRadius: 5,
        }} />
      </div>
      <div
        className="point-label"
        data-point-id={pid}
        onClick={(e) => onSelect(e, pid)}
        style={{ position: 'absolute', ...lblPos, zIndex: 4, cursor: 'pointer' }}
      >
        <Tex fontSize={POINT_NAME_SIZE} color={theme.text.ink}>{pt.name ?? pid}</Tex>
      </div>
    </span>
  )
}
