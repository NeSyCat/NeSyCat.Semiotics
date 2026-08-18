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

export async function createDiagram(organizationId: string, title?: string): Promise<DiagramRow> {
  const { jwt } = await session()
  const row = await withRLS(jwt, (tx) =>
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
  revalidatePath('/editor', 'layout')
}

export async function renameDiagram(id: string, title: string): Promise<void> {
  const { jwt } = await session()
  const trimmed = title.trim() || 'Untitled'
  await withRLS(jwt, (tx) =>
    tx.orm.public.diagrams.where({ id }).update({ title: trimmed, updated_at: new Date() }),
  )
  revalidatePath('/editor', 'layout')
}
