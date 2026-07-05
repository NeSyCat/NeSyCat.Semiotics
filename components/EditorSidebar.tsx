'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  createDiagram,
  deleteDiagram,
  renameDiagram,
} from '@/lib/actions/diagrams'
import type { Diagram } from '@/_concept/03-orm-schema/schema'

// ── Icons ──────────────────────────────────────────────────────────────────
function SearchIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  )
}

function PenIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
    </svg>
  )
}

function XIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 6l-6 6 6 6" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 6l6 6-6 6" />
    </svg>
  )
}

function Spinner() {
  return (
    <svg width={12} height={12} viewBox="0 0 24 24" fill="none" aria-hidden style={{ animation: 'spin 0.9s linear infinite' }}>
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

// ── DiagramItem ─────────────────────────────────────────────────────────────
// Renders only the name pill. Rename/delete are in the top toolbar, operating
// on the currently selected diagram. Double-click still triggers inline rename.
function DiagramItem({
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

// ── Helpers ─────────────────────────────────────────────────────────────────
const UUID_IN_PATH = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i

function editorPath(id: string): string {
  if (typeof window !== 'undefined' && window.location.host === 'semiotics.nesycat.org') {
    return `/${id}`
  }
  return `/editor/${id}`
}

// ── EditorSidebar ────────────────────────────────────────────────────────────
export default function EditorSidebar({ diagrams }: { diagrams: Diagram[] }) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(true)
  const [, startNavTransition] = useTransition()
  const [optimisticId, setOptimisticId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [optimisticNew, setOptimisticNew] = useState<Diagram | null>(null)

  const [query, setQuery] = useState('')
  const searchInputRef = useRef<HTMLInputElement>(null)

  // Which diagram is being inline-renamed (triggered from toolbar)
  const [editingId, setEditingId] = useState<string | null>(null)

  // Expose sidebar width for canvas overlay controls
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--sidebar-offset', open ? '250px' : '0px')
    return () => { root.style.removeProperty('--sidebar-offset') }
  }, [open])

  useEffect(() => {
    const match = pathname.match(UUID_IN_PATH)
    if (match && optimisticId === match[1]) setOptimisticId(null)
  }, [pathname, optimisticId])

  useEffect(() => {
    if (!optimisticNew) return
    if (diagrams.some((d) => d.id === optimisticNew.id)) setOptimisticNew(null)
  }, [diagrams, optimisticNew])

  const activePathId = pathname.match(UUID_IN_PATH)?.[1] ?? null
  const selectedId = optimisticId ?? activePathId

  const goTo = (id: string) => {
    if (selectedId === id) return
    setOptimisticId(id)
    startNavTransition(() => { router.push(editorPath(id)) })
  }

  const onCreate = () => {
    if (creating) return
    setCreating(true)
    startNavTransition(async () => {
      try {
        const row = await createDiagram()
        setOptimisticNew(row)
        setOptimisticId(row.id)
        router.push(editorPath(row.id))
      } catch (err) {
        console.error('createDiagram failed', err)
      } finally {
        setCreating(false)
      }
    })
  }

  // Toolbar rename: trigger inline edit on the selected DiagramItem
  const handleRename = () => {
    if (!selectedId) return
    setEditingId(selectedId)
  }

  // Toolbar delete: delete the currently selected diagram
  const handleDelete = () => {
    if (!selectedId) return
    const d = [...diagrams, ...(optimisticNew ? [optimisticNew] : [])].find((x) => x.id === selectedId)
    if (!confirm(`Delete "${d?.title || 'Untitled'}"? This can't be undone.`)) return
    startNavTransition(async () => {
      await deleteDiagram(selectedId)
      const onThis = pathname.includes(selectedId)
      if (onThis) {
        router.push(
          typeof window !== 'undefined' && window.location.host === 'semiotics.nesycat.org'
            ? '/'
            : '/editor'
        )
      } else {
        router.refresh()
      }
    })
  }

  const renderedDiagrams = optimisticNew
    ? [optimisticNew, ...diagrams.filter((d) => d.id !== optimisticNew.id)]
    : diagrams

  const q = query.trim().toLowerCase()
  const filteredDiagrams = q
    ? renderedDiagrams.filter((d) => (d.title || 'Untitled').toLowerCase().includes(q))
    : renderedDiagrams

  const hasSelection = !!selectedId

  return (
    <>
      <aside
        className="absolute inset-y-0 left-0 z-10 overflow-hidden"
        style={{ width: 250, background: 'transparent', pointerEvents: 'none' }}
      >
        <div
          className="flex h-full flex-col"
          style={{
            width: 250,
            transform: open ? 'translateX(0)' : 'translateX(-100%)',
            transition: 'transform 200ms ease',
          }}
        >

          {/* Top toolbar: [🔍 search] [+ ✏️ 🗑️ actions] */}
          <div className="px-1 pt-3 flex items-center gap-2">

            {/* Search pill — always expanded */}
            <div
              className="pill editor-pill relative"
              style={{ pointerEvents: 'auto', flex: '1 1 auto', minWidth: 0 }}
            >
              <span
                aria-hidden="true"
                className="absolute left-3 top-1/2 -translate-y-1/2 flex items-center"
                style={{ color: 'var(--color-muted-foreground)', pointerEvents: 'none' }}
              >
                <SearchIcon />
              </span>
              <input
                ref={searchInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setQuery('') }}
                placeholder="Search…"
                aria-label="Search diagrams"
                className="w-full outline-none"
                style={{
                  height: 36,
                  background: 'transparent',
                  border: 'none',
                  fontSize: 14,
                  padding: query ? '0 34px 0 34px' : '0 10px 0 34px',
                  color: 'var(--color-foreground)',
                  fontFamily: 'var(--font-sans, system-ui, sans-serif)',
                }}
              />
              {query && (
                <button
                  type="button"
                  aria-label="Clear search"
                  title="Clear search"
                  onClick={() => setQuery('')}
                  className="btn btn-icon absolute right-0"
                  style={{ color: 'var(--color-muted-foreground)' }}
                >
                  <XIcon />
                </button>
              )}
            </div>

            {/* Actions pill: new · rename · delete */}
            <div className="pill editor-pill" style={{ pointerEvents: 'auto' }}>
              <button
                type="button"
                onClick={onCreate}
                disabled={creating}
                aria-label="New diagram"
                title="New diagram"
                className="btn btn-icon disabled:opacity-70"
                style={{ color: 'var(--color-muted-foreground)' }}
              >
                {creating ? <Spinner /> : <PlusIcon />}
              </button>
              <button
                type="button"
                onClick={handleRename}
                disabled={!hasSelection}
                aria-label="Rename selected diagram"
                title="Rename"
                className="btn btn-icon disabled:opacity-30"
                style={{ color: 'var(--color-muted-foreground)' }}
              >
                <PenIcon />
              </button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={!hasSelection}
                aria-label="Delete selected diagram"
                title="Delete"
                className="btn btn-icon diagram-item-delete disabled:opacity-30"
                style={{ color: 'var(--color-muted-foreground)' }}
              >
                <XIcon />
              </button>
            </div>
          </div>

          {/* Diagram list */}
          <div className="flex-1 overflow-auto pt-3">
            {filteredDiagrams.length === 0 ? (
              <div className="t-small px-4 py-4" style={{ color: 'var(--color-muted-foreground)' }}>
                {creating ? 'Creating…' : q ? 'No matches.' : 'No diagrams yet.'}
              </div>
            ) : (
              filteredDiagrams.map((d) => (
                <DiagramItem
                  key={d.id}
                  d={d}
                  active={selectedId === d.id}
                  pending={optimisticId === d.id || optimisticNew?.id === d.id}
                  onSelect={() => goTo(d.id)}
                  triggerEdit={editingId === d.id}
                  onDoneEditing={() => setEditingId(null)}
                />
              ))
            )}
          </div>
        </div>
      </aside>

      {/* Collapse pill — sticks out to the right of the sidebar */}
      {open && (
        <div
          className="pill editor-pill"
          style={{ position: 'absolute', top: 12, left: 254, zIndex: 20, pointerEvents: 'auto' }}
        >
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Collapse sidebar"
            title="Collapse"
            className="btn btn-icon"
            style={{ color: 'var(--color-muted-foreground)' }}
          >
            <ChevronLeftIcon />
          </button>
        </div>
      )}
      {!open && (
        <div
          className="pill editor-pill"
          style={{ position: 'absolute', top: 12, left: 12, zIndex: 20, pointerEvents: 'auto' }}
        >
          <button
            type="button"
            onClick={() => setOpen(true)}
            aria-label="Expand sidebar"
            title="Expand"
            className="btn btn-icon"
            style={{ color: 'var(--color-muted-foreground)' }}
          >
            <ChevronRightIcon />
          </button>
        </div>
      )}
    </>
  )
}
