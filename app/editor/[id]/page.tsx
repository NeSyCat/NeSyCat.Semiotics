import { notFound, redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/supabase/env'
import CanvasRoot from '@/components/editor/ui/Canvas'
import UserMenu from '@/components/UserMenu'
import { loadDiagram } from '@/lib/actions/diagrams'
import { getCachedMe } from '@/lib/actions/read-cache'
import { resolveActiveOrg } from '@/lib/active-org'
import { restoreDiagram } from '@/components/editor/persist/io'
import { diagramSsrPreview } from '@/components/editor/export/html'
import { serverCallbackUrl, serverEditorHref } from '@/lib/editor-url.server'

export default async function EditorDiagramPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  // Env-less boot (CI, fresh checkout): nobody can be signed in — fall
  // through to the anonymous redirect below. See lib/supabase/env.ts.
  const user = supabaseConfigured() ? await getAuthUser() : null
  // Diagram ids are DB rows — anonymous visitors have none. Browsers
  // re-apply a URL fragment across a redirect when the Location header has
  // no fragment of its own, so a shared `/editor/<id>#d=…` link still lands
  // the diagram in front of them via the anonymous editor.
  if (!user) redirect(await serverEditorHref())

  // loadDiagram and getMe only depend on the session (already confirmed
  // above), not on each other — run them concurrently instead of in
  // sequence. getCachedMe() is the same request-scoped instance the layout
  // above this page also calls, so this doesn't add a second DB round trip
  // when the layout's call already resolved (or is in flight).
  const [row, me] = await Promise.all([loadDiagram(id), getCachedMe()])
  if (!row) notFound()
  const activeOrgId = await resolveActiveOrg(me)
  // Routes load arbitrary persisted JSON; restoreDiagram normalizes the shape
  // (default fields, version migration) before the store ever sees it.
  const initialData = restoreDiagram(row.data)
  // Static first-paint snapshot, rendered into the SSR HTML — see
  // CanvasRoot's ssrPreview prop. Best-effort: a drawing bug in the preview
  // must never take down the page itself.
  let ssrPreview: string | undefined
  try {
    ssrPreview = diagramSsrPreview(initialData)
  } catch (err) {
    console.error('diagramSsrPreview failed, loading without first-paint snapshot:', err)
  }
  return (
    <CanvasRoot
      diagramId={id}
      initialData={initialData}
      ssrPreview={ssrPreview}
      topRight={
        <UserMenu me={me} activeOrgId={activeOrgId} callbackUrl={await serverCallbackUrl()} />
      }
    />
  )
}
