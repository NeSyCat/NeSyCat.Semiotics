'use client'

import { Handle, Position } from '@xyflow/react'
import theme from './theme'
import { geometryFor, POINT_SIZE, type Anchor } from '../domain/forms'
import { toRgbTriple } from '../domain/color'
import { Tex } from './Tex'
import { ShapeBody, tintFill } from './ShapeBody'
import type { Point, Shape } from '../domain/types'

const POINT_NAME_SIZE = 12 // points a little smaller than the form name
// A point's grab-pad size — doubles as its glyph's rendered diameter
// (POINT_SIZE, domain/forms.ts), so a point's draggable area and visual
// glyph coincide exactly.
const REGION_CORNER_SIZE = POINT_SIZE

// The screen-space cardinal that a form-local edge direction faces once the
// node is rotated by `rotation` (CSS rotate — clockwise in screen Y-down
// space). Used to place a point's label outward ON SCREEN, not in the
// unrotated frame: e.g. an apex-up triangle sits at rotation 270, where its
// 'peak' edge (form-local Right) points UP on screen, so its label belongs
// above the apex — not off to one side.
function screenCardinal(position: Position, rotation: number): 'left' | 'right' | 'top' | 'bottom' {
  const base: [number, number] =
    position === Position.Left ? [-1, 0]
      : position === Position.Right ? [1, 0]
        : position === Position.Top ? [0, -1]
          : [0, 1]
  const th = (rotation * Math.PI) / 180
  const c = Math.cos(th)
  const s = Math.sin(th)
  const x = base[0] * c - base[1] * s
  const y = base[0] * s + base[1] * c
  // snap to the nearest screen cardinal (exact for 90° multiples)
  return Math.abs(x) >= Math.abs(y) ? (x >= 0 ? 'right' : 'left') : y >= 0 ? 'bottom' : 'top'
}

// A point's glyph reuses the SAME geometry a form of that shape draws its
// own body from (geometryFor(shape).body — domain/forms.ts's registry) and
// renders it through ui/ShapeBody.tsx, the ONE shared border/fill
// implementation FormNode.tsx's BodyView also goes through — "a point looks
// exactly like a miniature form body" is structural, not two copies of the
// same drawing code. Base interior fill (transparent / color tint /
// selected tint) follows ShapeBody's tintFill, the SAME rule BodyView's own
// fill uses; hover then COMPOSITES a second, borderless ShapeBody tint layer
// on top — same two-layer pattern as FormNode.tsx's CenterOverlay (a hover
// preview is a separate concern from "is this currently selected", so it
// stacks rather than replaces). Both layers render INSIDE the glyph's own
// outline — no separate halo/disc behind it. Deliberately does NOT fall
// back to the form's own accent when the point has no color of its own — a
// point sitting on a colored form must NOT read as tinted by that form's
// color unless the point itself was explicitly given one (own color only).
function PointGlyph({ shape, accent, isSelected, isHovered }: { shape: Shape; accent: string | null; isSelected: boolean; isHovered: boolean }) {
  // ShapeBody's <svg> is position:absolute — it overlays onto whatever box
  // its caller supplies (see BodyView, which gives it the form node's own
  // n×n box). An out-of-flow child contributes NOTHING to a parent's
  // intrinsic size, so this wrapper must carry POINT_SIZE explicitly AND
  // establish the positioned containing block ShapeBody's inset:0 resolves
  // against. Skip either half and this box — and, transitively, PointVisual's
  // own ancestor div that centers it via translate(-50%,-50%) computed off
  // ITS measured size — collapses to 0×0, pinning the glyph to its top-left
  // corner instead of centering it on the anchor.
  const wrapStyle: React.CSSProperties = { position: 'relative', width: POINT_SIZE, height: POINT_SIZE }
  if (shape === 'empty') {
    // No shape geometry to outline — a plain circular hover/selection
    // indicator only (no border, no color tint; matches the previous
    // halo's own limited behavior for a shapeless point). Selected wins
    // outright here — there's no color layer to also composite with, unlike
    // the shaped case below.
    const fill = isSelected ? theme.node.regionSelected : isHovered ? theme.node.regionHover : 'transparent'
    return <div style={wrapStyle}><ShapeBody body={{ type: 'circle' }} n={POINT_SIZE} fill={fill} strokeWidth={0} /></div>
  }
  const body = geometryFor(shape).body
  return (
    <div style={wrapStyle}>
      {/* Opaque canvas-colored base — BELOW the tint layer, not a
          replacement for it. tintFill's own "idle+uncolored is transparent"
          rule stays correct for a FORM's body (BodyView), which genuinely
          means to show whatever's behind it; a point's glyph is different —
          wires are drawn straight through their true anchors now (no
          endpoint pull-back, see ui/LineEdge.tsx), so a glyph sitting on a
          wire must be opaque to actually HIDE the wire underneath it,
          exactly like export/geometry-ir.ts's buildPointCmds already
          flattens every point glyph over an opaque white backing for the
          same masking reason. 'empty'-shaped points render no glyph at all
          (see the branch above) — nothing to mask there, and there never was. */}
      <ShapeBody body={body} n={POINT_SIZE} fill={theme.canvas.background} strokeWidth={0} />
      <ShapeBody body={body} n={POINT_SIZE} fill={tintFill(accent, isSelected)} />
      {isHovered && <ShapeBody body={body} n={POINT_SIZE} fill={theme.node.regionHover} strokeWidth={0} />}
    </div>
  )
}

// One point's full visual: drag-region tint, glyph, drag/select handles, and
// name label (plus its canvas-coloured mask so wires don't strike through
// it) — everything FormNode's per-edge point loop renders for a single
// point. Props are exactly what that loop body reads per-point; the
// geometry loop itself (edgeKeys × pointIdsAt) stays in FormNode since it's
// shared setup, not per-point rendering.
export function PointVisual({ pid, pt, anchor, labelSplay, hid, isSelected, isHovered, formRotation, onSelect }: {
  pid: string
  pt: Point
  anchor: Anchor
  // Extra along-edge label nudge computed by FormNode's edgeLabelSplay
  // (mirrors ir/geometry-ir.ts's edgeLabelSplayLocal) — {0,0} for a lone
  // point or an odd-count edge's exact centre point. See that function's
  // comment for the full "why" (splays co-edge labels apart instead of
  // letting them collide).
  labelSplay: { x: number; y: number }
  hid: string
  isSelected: boolean
  isHovered: boolean
  formRotation: number
  onSelect: (e: React.MouseEvent, pid: string) => void
}) {
  // Own color only — see PointGlyph's comment above for why this must NOT
  // fall back to the form's accent.
  const glyphAccent = pt.color ? toRgbTriple(pt.color) : null

  // The name label sits GAP px OUTSIDE the point, in the direction its edge
  // faces ON SCREEN. That direction is form-LOCAL (anchor.position), but the
  // whole node — points and labels — is rotated by formRotation (FormNode's CSS
  // rotate), so a form-local "Right" edge can point any way on screen (UP, for
  // an apex-up triangle at rotation 270). screenCardinal maps the local edge
  // direction through the rotation to the real screen cardinal; each label is
  // then rendered inside a per-point wrapper (below) that COUNTER-rotates by
  // -formRotation, so lblPos acts in an upright, screen-aligned frame and the
  // edge-pinning translate keeps the label's INNER edge GAP from the point.
  // Pin/offset in the LOCAL frame instead and a wide label's TEXT WIDTH becomes
  // outward distance under the rotation, flinging it far off the body — the
  // "labels sit too far from the triangle" bug.
  const GAP = 16 // matches geometry-ir LABEL_GAP_PX; clears the 13px glyph half so labels do not overlap the form
  const screenDir = screenCardinal(anchor.position, formRotation)
  // labelSplay is already a SCREEN-space nudge (FormNode.edgeLabelSplay rotates
  // the edge tangent by formRotation), so it adds directly in the wrapper's
  // screen-aligned frame — ~0 on whichever screen axis the edge doesn't run along.
  const sx = labelSplay.x
  const sy = labelSplay.y
  const lblPos: React.CSSProperties =
    screenDir === 'left' ? { left: -GAP + sx, top: sy, transform: 'translate(-100%, -50%)' }
      : screenDir === 'right' ? { left: GAP + sx, top: sy, transform: 'translate(0, -50%)' }
        : screenDir === 'top' ? { left: sx, top: -GAP + sy, transform: 'translate(-50%, -100%)' }
          : { left: sx, top: GAP + sy, transform: 'translate(-50%, 0)' }
  // The rendered label text: the point's own name, or its generated id ("p3")
  // as a default placeholder. A cleared name ('' — set via renamePoints) yields
  // an EMPTY label, in which case NOTHING is rendered (no text AND no mask), so
  // a blank point never leaves a stray band masking the wires under it.
  const labelText = pt.name ?? pid

  // Handles are 1px AT the glyph centre, so a line anchors dead-centre on the
  // point (RF pins a handle to its position-edge — a large handle offsets the
  // line). The source carries an ~18px transparent grab pad; its pointer
  // events bubble up to the handle, so the point is still easy to grab/drag.
  const dotStyle: React.CSSProperties = {
    position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
    width: 1, height: 1, minWidth: 1, minHeight: 1, background: 'transparent', border: 'none', padding: 0, zIndex: 5,
  }
  return (
    <span>
      {/* glyph: visual only, behind the handles. Hover/selection tint is
          PAINTED INSIDE the glyph's own outline (PointGlyph -> ShapeBody's
          fill, via tintFill) — there is no separate halo/disc behind it; a
          point's own drag-region hover always wins over the form's
          region/center hover (decided centrally in Canvas.tsx's
          nearestPointWithin). */}
      <div style={{
        position: 'absolute', top: anchor.y, left: anchor.x, transform: 'translate(-50%, -50%)',
        zIndex: 4, pointerEvents: 'none', lineHeight: 0,
      }}>
        <PointGlyph shape={pt.shape} accent={glyphAccent} isSelected={isSelected} isHovered={isHovered} />
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
      {labelText !== '' && (
        <>
          {/* Both label layers live in a per-point wrapper anchored AT the point
              that counter-rotates by -formRotation — giving lblPos an upright,
              screen-aligned frame (see screenCardinal above). Each wrapper keeps
              its own zIndex so the rotation fix doesn't disturb the layering:
              mask at 0 (above the edges, below every tint overlay so form hover
              sweeps across the name instead of notching it), visible name at 4
              (above the tints). transformOrigin '0 0' pins the rotation to the
              anchor, which is where left/top place the wrapper's top-left. */}
          <div style={{ position: 'absolute', left: anchor.x, top: anchor.y, transform: `rotate(${-formRotation}deg)`, transformOrigin: '0 0', zIndex: 0, pointerEvents: 'none' }}>
            <div className="point-label" aria-hidden="true" style={{ position: 'absolute', ...lblPos }}>
              <span style={{ visibility: 'hidden' }}>
                <Tex fontSize={POINT_NAME_SIZE} color={theme.text.ink}>{labelText}</Tex>
              </span>
              <span style={{
                position: 'absolute', left: -2, right: -2, top: '15%', bottom: '15%',
                background: theme.canvas.background, borderRadius: 5,
              }} />
            </div>
          </div>
          <div style={{ position: 'absolute', left: anchor.x, top: anchor.y, transform: `rotate(${-formRotation}deg)`, transformOrigin: '0 0', zIndex: 4 }}>
            <div
              className="point-label"
              data-point-id={pid}
              onClick={(e) => onSelect(e, pid)}
              style={{ position: 'absolute', ...lblPos, cursor: 'pointer' }}
            >
              <Tex fontSize={POINT_NAME_SIZE} color={theme.text.ink}>{labelText}</Tex>
            </div>
          </div>
        </>
      )}
    </span>
  )
}
