import { Suspense } from 'react'
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
import LoadingScreen from '@/components/LoadingScreen'

// `params` is not awaited here — it's handed down as a promise so the page
// itself does no dynamic work at the top level. The static shell (this
// Suspense fallback) is what the build-time prerender produces; everything
// that depends on params/auth/the DB row resolves inside EditorDiagramContent,
// behind the boundary, and streams in once ready. Fallback matches the
// existing sibling loading.tsx exactly, so the shown UI is unchanged.
export default function EditorDiagramPage(props: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<LoadingScreen message="Loading diagram…" position="absolute" />}>
      <EditorDiagramContent paramsPromise={props.params} />
    </Suspense>
  )
}

async function EditorDiagramContent({
  paramsPromise,
}: {
  paramsPromise: Promise<{ id: string }>
}) {
  const { id } = await paramsPromise
  // Env-less boot (CI, fresh checkout): nobody can be signed in — fall
  // through to the anonymous redirect below. See lib/supabase/env.ts.
  const user = supabaseConfigured() ? await getAuthUser() : null
  // Diagram ids are DB rows — anonymous visitors have none. Browsers
  // re-apply a URL fragment across a redirect when the Location header has
  // no fragment of its own, so a shared `/editor/<id>#d=…` link still lands
  // the diagram in front of them via the anonymous editor.
  // Note: this fires after the Suspense boundary above has already streamed
  // a 200 OK, so — like every redirect() below a boundary — it becomes a
  // client-side redirect rather than an HTTP 3xx response. Acceptable: the
  // shell paints instantly either way, and the hop happens immediately.
  if (!user) redirect(await serverEditorHref())

  // loadDiagram and getMe only depend on the session (already confirmed
  // above), not on each other — run them concurrently instead of in
  // sequence. getCachedMe() is the same request-scoped instance the layout
  // above this page also calls, so this doesn't add a second DB round trip
  // when the layout's call already resolved (or is in flight).
  const [row, me] = await Promise.all([loadDiagram(id), getCachedMe()])
  // Trade-off: notFound() here runs after streaming has already begun (the
  // Suspense fallback above already committed the response to 200 OK), so
  // Next.js cannot rewrite the status code for a missing/foreign diagram id.
  // Instead it injects <meta name="robots" content="noindex"> into the
  // streamed not-found UI — a 200 response that's excluded from indexing,
  // not a real HTTP 404. See node_modules/next/dist/docs/01-app/02-guides/
  // streaming.md, "The HTTP contract" / "Status codes". Diagram pages are
  // never crawled/indexed anyway (auth-gated), so this trade-off has no
  // practical SEO impact here; flagging it per the ticket's requirement.
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
