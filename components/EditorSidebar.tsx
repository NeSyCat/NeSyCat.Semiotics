'use client'

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef, useState, useTransition } from 'react'
import {
  createDiagram,
  deleteDiagram,
} from '@/lib/actions/diagrams'
import { clientEditorHref } from '@/lib/editor-url'
import type { Diagram } from '@/lib/db'
import {
  SearchIcon,
  PlusIcon,
  PenIcon,
  XIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  Spinner,
} from '@/components/icons'
import DiagramItem from '@/components/DiagramItem'

// ── Helpers ─────────────────────────────────────────────────────────────────
const UUID_IN_PATH = /\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:\/|$)/i

// ── EditorSidebar ────────────────────────────────────────────────────────────
export default function EditorSidebar({
  diagrams,
  activeOrgId,
}: {
  diagrams: Diagram[]
  // Computed server-side (resolveActiveOrg) in app/editor/layout.tsx — new
  // diagrams from the sidebar's "+" button go into the active org.
  activeOrgId: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [open, setOpen] = useState(true)
  const [, startNavTransition] = useTransition()
  const [optimisticId, setOptimisticId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [optimisticNew, setOptimisticNew] = useState<Diagram | null>(null)
  // Optimistic delete: ids hidden from the list immediately on click, before
  // the server confirms. Rolled back (removed from this set) if the action
  // throws. `diagrams` itself is the server-fetched prop — never mutated.
  const [removedIds, setRemovedIds] = useState<Set<string>>(new Set())
  const [deleteError, setDeleteError] = useState<string | null>(null)

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

  // Once the server-fetched prop actually stops containing a deleted id
  // (i.e. a real navigation picked up the fresh list), drop it from the
  // optimistic removal set — nothing left for it to hide.
  useEffect(() => {
    setRemovedIds((prev) => {
      if (prev.size === 0) return prev
      const stillPresent = [...prev].filter((id) => diagrams.some((d) => d.id === id))
      return stillPresent.length === prev.size ? prev : new Set(stillPresent)
    })
  }, [diagrams])

  const activePathId = pathname.match(UUID_IN_PATH)?.[1] ?? null
  const selectedId = optimisticId ?? activePathId

  const goTo = (id: string) => {
    if (selectedId === id) return
    setOptimisticId(id)
    startNavTransition(() => { router.push(clientEditorHref(id)) })
  }

  const onCreate = () => {
    if (creating) return
    setDeleteError(null)
    setCreating(true)
    startNavTransition(async () => {
      try {
        const row = await createDiagram(activeOrgId)
        setOptimisticNew(row)
        setOptimisticId(row.id)
        router.push(clientEditorHref(row.id))
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
    const id = selectedId
    const d = [...diagrams, ...(optimisticNew ? [optimisticNew] : [])].find((x) => x.id === id)
    if (!confirm(`Delete "${d?.title || 'Untitled'}"? This can't be undone.`)) return
    const onThis = pathname.includes(id)
    setDeleteError(null)
    // Optimistic: the row is gone from the list the instant the confirm
    // dialog closes, before the server has even been asked.
    setRemovedIds((prev) => new Set(prev).add(id))
    startNavTransition(async () => {
      try {
        await deleteDiagram(id)
        // Same special case as before: deleting the diagram you're currently
        // on navigates away; otherwise the optimistic removal above already
        // reflects the delete, and deleteDiagram's own revalidatePath keeps
        // the next real navigation fresh — no router.refresh() needed here.
        if (onThis) router.push(clientEditorHref())
      } catch (err) {
        console.error('deleteDiagram failed', err)
        setRemovedIds((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setDeleteError(`Couldn't delete "${d?.title || 'Untitled'}" — please try again.`)
      }
    })
  }

  const renderedDiagrams = (optimisticNew
    ? [optimisticNew, ...diagrams.filter((d) => d.id !== optimisticNew.id)]
    : diagrams
  ).filter((d) => !removedIds.has(d.id))

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
            {deleteError && (
              <p
                className="t-small px-4 pb-2"
                style={{ color: 'var(--color-destructive)' }}
              >
                {deleteError}
              </p>
            )}
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
