import theme from './theme'
import { Tex } from './Tex'

// THE general rule for on-canvas labels: a label hides the wire(s) beneath it.
// Every label paints a canvas-coloured band sized to its OWN text — an inert
// band, inset tighter than KaTeX's tall line box so it masks only around the
// glyphs — behind the visible text, so lines never strike through a name. One
// component for point names, form names, and the wire's own label alike,
// instead of re-deriving the mask per label type.
//
// Sizes itself to `text` at `fontSize` via a hidden Tex copy; the caller
// positions/rotates/z-indexes it (the mask must sit ABOVE the edges layer so it
// covers the wire, but BELOW hover/selection tints so those sweep across the
// name uninterrupted — see how PointVisual/FormNode place it).
export function LabelMask({ text, fontSize }: { text: string; fontSize: number }) {
  if (text === '') return null
  return (
    <span aria-hidden="true" style={{ position: 'relative', display: 'inline-block', pointerEvents: 'none' }}>
      <span style={{ visibility: 'hidden' }}>
        <Tex fontSize={fontSize} color={theme.text.ink}>{text}</Tex>
      </span>
      <span style={{
        position: 'absolute', left: -2, right: -2, top: '15%', bottom: '15%',
        background: theme.canvas.background, borderRadius: 5,
      }} />
    </span>
  )
}
