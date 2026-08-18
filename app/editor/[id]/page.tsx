import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import CanvasRoot from '@/components/editor/ui/Canvas'
import UserMenu from '@/components/UserMenu'
import { loadDiagram } from '@/lib/actions/diagrams'
import { getMe } from '@/lib/actions/organizations'
import { resolveActiveOrg } from '@/lib/active-org'
import { restoreDiagram } from '@/components/editor/persist/io'
import { serverCallbackUrl, serverEditorHref } from '@/lib/editor-url.server'

export default async function EditorDiagramPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Diagram ids are DB rows — anonymous visitors have none. Browsers
  // re-apply a URL fragment across a redirect when the Location header has
  // no fragment of its own, so a shared `/editor/<id>#d=…` link still lands
  // the diagram in front of them via the anonymous editor.
  if (!user) redirect(await serverEditorHref())

  const row = await loadDiagram(id)
  if (!row) notFound()
  const me = await getMe()
  const activeOrgId = await resolveActiveOrg(me)
  // Routes load arbitrary persisted JSON; restoreDiagram normalizes the shape
  // (default fields, version migration) before the store ever sees it.
  return (
    <CanvasRoot
      diagramId={id}
      initialData={restoreDiagram(row.data)}
      topRight={
        <UserMenu me={me} activeOrgId={activeOrgId} callbackUrl={await serverCallbackUrl()} />
      }
    />
  )
}
