'use client'

// No-auth playground for the editor2 rebuild — renders the new editor with an
// empty in-memory diagram (no sign-in, no DB save). Dev/preview convenience;
// remove or gate before shipping to production.
import CanvasRoot from '@/components/editor2/Canvas'

export default function Playground() {
  return (
    <div style={{ position: 'fixed', inset: 0 }}>
      <CanvasRoot diagramId={null} initialData={{ schemaVersion: 1, forms: [], points: {}, lines: [] }} />
    </div>
  )
}
