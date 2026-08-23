'use client'

// SVG sprite — copied verbatim from _design/04-prototype (the mockup). The DS
// `.pill .btn svg` rule paints these fill:none / stroke:currentColor.
export function ToolbarSprite() {
  return (
    <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden="true">
      <defs>
        <symbol id="ic-direction-center" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="8" stroke="currentColor" strokeWidth="1.7" />
          <circle cx="12" cy="12" r="2.4" fill="currentColor" stroke="none" />
        </symbol>
        <symbol id="ic-weight" viewBox="0 0 24 24">
          <path d="M9 7a3 3 0 1 1 6 0" />
          <path d="M7 9h10l1.6 11H5.4z" />
        </symbol>
        <symbol id="ic-scale" viewBox="0 0 24 24" fill="none">
          <path d="M9 4H4v5M15 20h5v-5M4 4l6 6M20 20l-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" transform="rotate(90 12 12)" />
        </symbol>
        <symbol id="ic-rotation" viewBox="0 0 24 24" fill="none">
          <path d="M19 12a7 7 0 1 1-2.05-4.95" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
          <path d="M19 4v4h-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="ic-location" viewBox="0 0 24 24">
          <path d="M12 3v18M3 12h18" />
          <path d="M12 3l-2 2.5M12 3l2 2.5" />
          <path d="M12 21l-2-2.5M12 21l2-2.5" />
          <path d="M3 12l2.5-2M3 12l2.5 2" />
          <path d="M21 12l-2.5-2M21 12l-2.5 2" />
        </symbol>
        <symbol id="ic-eye" viewBox="0 0 24 24" fill="none">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="12" cy="12" r="3" stroke="currentColor" strokeWidth="1.7" />
        </symbol>
        <symbol id="ic-eye-off" viewBox="0 0 24 24" fill="none">
          <path d="M9.9 5.14A10.7 10.7 0 0 1 12 5c6.4 0 10 7 10 7a13.3 13.3 0 0 1-3.05 3.9m-2.87 1.9A10.7 10.7 0 0 1 12 19c-6.4 0-10-7-10-7a13.3 13.3 0 0 1 4.22-4.8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M9.9 14.1a3 3 0 0 0 4.24-4.24" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </symbol>
        <symbol id="ic-grid" viewBox="0 0 24 24" fill="none">
          <rect x="3" y="3" width="18" height="18" rx="1" stroke="currentColor" strokeWidth="1.7" />
          <path d="M3 9h18M3 15h18M9 3v18M15 3v18" stroke="currentColor" strokeWidth="1.7" />
        </symbol>
        <symbol id="ic-export" viewBox="0 0 24 24" fill="none">
          <path d="M12 15V4M12 4L7.5 8.5M12 4l4.5 4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        {/* Mirror of ic-export — same tray, arrow pointing the OTHER way (down,
            into the tray) for "bring something in". */}
        <symbol id="ic-import" viewBox="0 0 24 24" fill="none">
          <path d="M12 4v11M12 15l-4.5-4.5M12 15l4.5-4.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="ic-check" viewBox="0 0 24 24" fill="none">
          <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
        </symbol>
        <symbol id="kind-empty" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="9.25" fill="none" stroke="currentColor" strokeWidth="1.4" strokeDasharray="2.4 2.6" />
        </symbol>
        <symbol id="kind-triangle" viewBox="0 0 24 24"><path d="M21.25 12L7.375 20.011L7.375 3.989Z" /></symbol>
        <symbol id="kind-rhombus" viewBox="0 0 24 24"><path d="M12 2.75L21.25 12L12 21.25L2.75 12Z" /></symbol>
        {/* 'kind-hexagon' is NOT a Shape value (the vocabulary is just the 5
            in types.ts) — it survives here only as the generic decorative
            "shape" glyph used by the top-pill's Shape category icon and its
            activeShapeSymbol fallback below. */}
        <symbol id="kind-hexagon" viewBox="0 0 24 24"><path d="M12 2.75 L20.011 7.375 L20.011 16.625 L12 21.25 L3.989 16.625 L3.989 7.375 Z" /></symbol>
        <symbol id="kind-circle" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9.25" /></symbol>
        <symbol id="kind-rectangle" viewBox="0 0 24 24"><rect x="2.75" y="2.75" width="18.5" height="18.5" rx="0" ry="0" /></symbol>
      </defs>
    </svg>
  )
}

// A small inline copy glyph — not the sprite's ic-check (that's reserved for
// the row's own post-copy confirmation state, swapped in locally in ExportRow).
export function CopyGlyph() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="8" y="8" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.7" />
      <path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

// Shared cross/check glyphs for panel cancel/close and confirm buttons
// (ImportPanel's cross/check pair, ExportPanel's close). Sized by the
// `.editor-pill.pill .btn svg` rule when wrapped in a pill.
export function CloseIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    </svg>
  )
}

export function CheckIcon() {
  return (
    <svg width={24} height={24} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
