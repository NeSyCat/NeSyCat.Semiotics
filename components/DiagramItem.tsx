'use client'

import { useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import { renameDiagram } from '@/lib/actions/diagrams'
import type { Diagram } from '@/_concept/03-orm-schema/schema'
import { Spinner } from '@/components/icons'

// ── DiagramItem ─────────────────────────────────────────────────────────────
// Renders only the name pill. Rename/delete are in the top toolbar, operating
// on the currently selected diagram. Double-click still triggers inline rename.
export default function DiagramItem({
  d,
  active,
  pending,
  onSelect,
  triggerEdit,
  onDoneEditing,
}: {
  d: Diagram
  active: boolean
  pending: boolean
  onSelect: () => void
  triggerEdit: boolean
  onDoneEditing: () => void
}) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(d.title || 'Untitled')
  const [, startRowTransition] = useTransition()
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTitle(d.title || 'Untitled') }, [d.title])

  // Toolbar rename button sets triggerEdit → activate inline editing
  useEffect(() => {
    if (triggerEdit && !editing) setEditing(true)
  }, [triggerEdit]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  const commit = () => {
    const next = title.trim() || 'Untitled'
    setEditing(false)
    onDoneEditing()
    if (next === d.title) return
    startRowTransition(async () => {
      await renameDiagram(d.id, next)
      router.refresh()
    })
  }

  const cancel = () => {
    setTitle(d.title || 'Untitled')
    setEditing(false)
    onDoneEditing()
  }

  return (
    <div style={{ margin: '0 4px 6px', pointerEvents: 'auto' }}>
      <div
        onClick={() => { if (!editing) onSelect() }}
        onDoubleClick={(e) => { e.preventDefault(); setEditing(true) }}
        className="pill editor-pill cursor-pointer"
        style={{
          width: '100%',
          minWidth: 0,
          background: active ? 'color-mix(in srgb, var(--color-primary) 14%, transparent)' : undefined,
          borderColor: active ? 'color-mix(in srgb, var(--color-primary) 34%, transparent)' : undefined,
          transition: 'background 0.12s ease, border-color 0.12s ease',
        }}
      >
        {editing ? (
          <input
            ref={inputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commit}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit()
              else if (e.key === 'Escape') cancel()
            }}
            className="w-full bg-transparent outline-none"
            style={{
              height: 36,
              fontSize: 13,
              fontWeight: 500,
              color: 'var(--color-text-primary)',
              padding: '0 10px',
            }}
          />
        ) : (
          <div
            className="w-full truncate"
            style={{
              height: 36,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '0 10px',
              fontSize: 13,
              fontWeight: 500,
              color: active ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
            }}
          >
            <span className="truncate">{title || 'Untitled'}</span>
            {pending && (
              <span style={{ color: 'var(--color-primary)', display: 'inline-flex', flexShrink: 0 }}>
                <Spinner />
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
