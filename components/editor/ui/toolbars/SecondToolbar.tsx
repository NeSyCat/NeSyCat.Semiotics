'use client'

import type { Shape, Color } from '../../domain/types'
import { SHAPE_RAIL, COLOR_RAIL, sameColor, swatchStyle } from '../rails'
import { NameField } from '../fields/NameField'
import { RangeField } from '../fields/RangeField'
import type { SelectionTarget } from '../Canvas'

// Second toolbar — the conditional rail/field directly below the category
// spine: Shape rail / Color rail / Name field / Rotation slider / Scale
// slider, one at a time per `activeCategory`.
//
// Renders just the active pill itself (or nothing) — no positioning shell.
// Canvas composes this alongside MainToolbar inside ONE shared
// CenteredPillRow so both pills clamp/center as a single unit. See
// CenteredPillRow's comment.
export function SecondToolbar({
  activeCategory,
  selectedPoints, selectedPointShape, activeShape, onPickShape,
  selectionTarget, colorInfo, activeColor, onColor,
  nameInfo, onName,
  rotationInfo, onRotate,
  scaleInfo, onScale,
  selectedFormIds,
}: {
  activeCategory: string
  selectedPoints: string[]
  selectedPointShape: Shape | undefined
  activeShape: Shape
  onPickShape: (entry: { shape: Shape }) => void
  selectionTarget: SelectionTarget
  colorInfo: { shared: Color | undefined; isShared: boolean }
  activeColor: Color | null
  onColor: (color: Color | null) => void
  nameInfo: { value: string; placeholder: string; sig: string; disabled: boolean }
  onName: (value: string) => void
  rotationInfo: { value: number; sig: string }
  onRotate: (deg: number) => void
  scaleInfo: { value: number; sig: string }
  onScale: (pct: number) => void
  selectedFormIds: string[]
}) {
  return (
    <>
      {/* Second toolbar — the Shape rail. Only triangle/circle/square work. */}
      {activeCategory === 'shape' && (
        <div className="pill editor-pill" role="group" aria-label="Shape">
          {SHAPE_RAIL.map((s) => {
            const active = selectedPoints.length > 0 ? s.shape === selectedPointShape : s.shape === activeShape
            return (
              <button
                key={s.label}
                className={`btn btn-icon${active ? ' is-active' : ''}`}
                title={selectedPoints.length > 0
                  ? `${s.label} point`
                  : `${s.label} — apply to selected form, or drag onto canvas to create`}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('application/form-shape', s.shape)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => onPickShape(s)}
              >
                <svg aria-hidden="true"><use href={`#${s.symbol}`} /></svg>
              </button>
            )
          })}
        </div>
      )}

      {/* Second toolbar — the Color rail. Same target as the Name field
          (points > forms > lines); White resets to the default. Sizes to
          content, like the Shape rail. */}
      {activeCategory === 'color' && (
        <div className="pill editor-pill" role="group" aria-label="Color">
          {COLOR_RAIL.map((c) => {
            // With a selection, the rail reflects its shared color; without
            // one it reflects the active (creation-default) color — same
            // split as the Shape rail's selectedPointShape/activeShape.
            const active = selectionTarget
              ? colorInfo.isShared && sameColor(colorInfo.shared, c.color)
              : sameColor(activeColor, c.color)
            return (
              <button
                key={c.label}
                className={`btn btn-icon${active ? ' is-active' : ''}`}
                title={c.label}
                onClick={() => onColor(c.color)}
              >
                <span style={swatchStyle(c.color, active, 16)} />
              </button>
            )
          })}
        </div>
      )}

      {/* Name field — the whole pill is a text input renaming the current
          selection (points > forms > lines). Same width as the Shape rail. */}
      {activeCategory === 'name' && (
        <div className="pill editor-pill" style={{ width: 360, padding: '0 4px' }}>
          <NameField sig={nameInfo.sig} initial={nameInfo.value} placeholder={nameInfo.placeholder} disabled={!selectionTarget || nameInfo.disabled} onChange={onName} />
        </div>
      )}

      {/* Rotation field — a 0-359° slider over the selected form(s). Same
          width as the Shape rail. */}
      {activeCategory === 'rotation' && (
        <div className="pill editor-pill" style={{ width: 360, padding: '0 4px' }}>
          <RangeField
            sig={rotationInfo.sig} initial={rotationInfo.value} disabled={selectedFormIds.length === 0} onChange={onRotate}
            min={0} max={360} step={1} unit="°" snapMarks={[0, 90, 180, 270, 360]} wrap disabledValue={0}
          />
        </div>
      )}

      {/* Scale field — a 25-400% slider over the selected form(s). Same
          width/position as the Rotation pill. */}
      {activeCategory === 'scale' && (
        <div className="pill editor-pill" style={{ width: 360, padding: '0 4px' }}>
          <RangeField
            sig={scaleInfo.sig} initial={scaleInfo.value} disabled={selectedFormIds.length === 0} onChange={onScale}
            min={25} max={400} step={5} unit="%" snapMarks={[100, 200, 300, 400]} wrap={false} disabledValue={100}
          />
        </div>
      )}
    </>
  )
}
