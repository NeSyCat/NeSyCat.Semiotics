'use server'

import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { withRLS, type Diagram as DiagramRow, type NewDiagram } from '@/lib/db'
import type { Diagram } from '@/components/editor/domain/types'
import { emptyData } from '@/lib/constants'

async function session() {
  const supabase = await createClient()
  const {
    data: { session: s },
  } = await supabase.auth.getSession()
  if (!s) throw new Error('not authenticated')
  return { jwt: s.access_token, userId: s.user.id }
}

export async function listDiagrams(organizationId: string): Promise<DiagramRow[]> {
  const { jwt } = await session()
  return withRLS(jwt, (tx) =>
    // .toArray() (not bare .all()) because withRLS's fn must return a real
    // Promise<T> — .all() is an AsyncIterableResult (thenable, not a Promise).
    tx.orm.public.diagrams
      .where({ organization_id: organizationId })
      .orderBy((d) => d.updated_at.desc())
      .all()
      .toArray(),
  )
}

// Row creation WITHOUT revalidation — for callers already inside a RENDER
// (app/editor/page.tsx's zero-diagrams bootstrap creates the first diagram
// while rendering /editor): `revalidatePath` during render is illegal in
// Next 16 ("used revalidatePath during render which is unsupported") and
// 500s the page — the authed e2e lane's fresh seeded user caught this; a
// brand-new account's very first /editor load was broken. A render-path
// caller also doesn't NEED the revalidation: it redirects immediately, and
// that navigation renders the layout fresh anyway.
export async function createDiagramRow(organizationId: string, title?: string): Promise<DiagramRow> {
  const { jwt } = await session()
  return withRLS(jwt, (tx) =>
    tx.orm.public.diagrams.create({
      organization_id: organizationId,
      title: title ?? 'Untitled',
      // `data` is a jsonb column; the contract's JsonValue codec type needs
      // an index signature the app's plain Diagram interface doesn't carry
      // structurally — the value is genuinely JSON, so this is a type-only
      // cast at the persistence boundary, not a behavior change.
      data: emptyData as unknown as NewDiagram['data'],
    }),
  )
}

export async function createDiagram(organizationId: string, title?: string): Promise<DiagramRow> {
  const row = await createDiagramRow(organizationId, title)
  // `layout` (not the default `page`) because the diagrams list is fetched
  // in app/editor/layout.tsx, not a page — a `page`-scoped revalidation
  // wouldn't invalidate that cached list at all. `/editor` is already the
  // narrowest path that owns it (every /editor/* route shares this one
  // layout instance), so there is no tighter correct scope to narrow to;
  // the sidebar itself now applies this row optimistically and doesn't wait
  // on the invalidation — this only keeps the *next* real navigation fresh.
  // ONLY legal from a server action / route handler — render-path callers
  // must use createDiagramRow above.
  revalidatePath('/editor', 'layout')
  return row
}

export async function loadDiagram(id: string): Promise<DiagramRow | null> {
  const { jwt } = await session()
  return withRLS(jwt, (tx) => tx.orm.public.diagrams.first({ id }))
}

export async function saveDiagram(id: string, data: Diagram): Promise<void> {
  const { jwt } = await session()
  await withRLS(jwt, (tx) =>
    tx.orm.public.diagrams
      .where({ id })
      .update({ data: data as unknown as NewDiagram['data'], updated_at: new Date() }),
  )
}

export async function deleteDiagram(id: string): Promise<void> {
  const { jwt } = await session()
  await withRLS(jwt, (tx) => tx.orm.public.diagrams.where({ id }).delete())
  // Same scope reasoning as createDiagram above: `/editor`+`layout` is
  // already the minimal path/type pair that owns the diagrams list. The
  // sidebar removes the row optimistically on click, so this call is purely
  // for the next real navigation's freshness, not for this request's UI.
  revalidatePath('/editor', 'layout')
}

export async function renameDiagram(id: string, title: string): Promise<void> {
  const { jwt } = await session()
  const trimmed = title.trim() || 'Untitled'
  await withRLS(jwt, (tx) =>
    tx.orm.public.diagrams.where({ id }).update({ title: trimmed, updated_at: new Date() }),
  )
  // Same scope reasoning as createDiagram above. The renamed row is shown
  // optimistically by DiagramItem the instant it commits (no router.refresh()
  // on success), so this revalidation only matters for the next real
  // navigation, not this one.
  revalidatePath('/editor', 'layout')
}
