'use client'

import { useMemo } from 'react'
import katex from 'katex'

// Renders a string as KaTeX (Quiver-style math labels). Invalid LaTeX shows in
// red instead of throwing. The raw source is edited ONLY in the Name field —
// canvas labels are read-only rendered math.
export function Tex({ children, fontSize, color }: { children: string; fontSize: number; color?: string }) {
  const html = useMemo(
    () => katex.renderToString(children || '', { throwOnError: false, displayMode: false, output: 'html' }),
    [children],
  )
  return (
    <span
      style={{ fontSize, color, lineHeight: 1.1, whiteSpace: 'nowrap', display: 'inline-block' }}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
