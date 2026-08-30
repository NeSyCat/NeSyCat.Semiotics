import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/supabase/env'
import { createDiagramRow } from '@/lib/actions/diagrams'
import { getCachedMe, getCachedListDiagrams } from '@/lib/actions/read-cache'
import { resolveActiveOrg } from '@/lib/active-org'
import { serverCallbackUrl, serverEditorHref } from '@/lib/editor-url.server'
import AnonymousEditor from '@/components/editor/AnonymousEditor'
import AuthSharePill from '@/components/AuthSharePill'
import LoadingScreen from '@/components/LoadingScreen'

// The whole page is auth-dependent (anonymous sandbox vs. redirect to an
// existing/new diagram), so there's no static content to hoist above the
// Suspense boundary — this mirrors the sibling loading.tsx fallback exactly,
// so wrapping here (rather than relying solely on the implicit loading.tsx
// boundary) doesn't change what's shown, only makes the boundary explicit.
export default function EditorIndex() {
  return (
    <Suspense fallback={<LoadingScreen message="Opening editor…" position="fixed" />}>
      <EditorIndexContent />
    </Suspense>
  )
}

async function EditorIndexContent() {
  // No Supabase env (CI, fresh checkout) → there can be no user; go straight
  // to the anonymous sandbox instead of crashing on client creation.
  // See lib/supabase/env.ts.
  const user = supabaseConfigured() ? await getAuthUser() : null
  // Anonymous: render the auth-free editor directly — never run
  // session-throwing actions (listDiagrams/createDiagram) without a user.
  if (!user) {
    return (
      <AnonymousEditor
        topRight={
          <AuthSharePill callbackUrl={await serverCallbackUrl()} />
        }
      />
    )
  }

  const me = await getCachedMe()
  const org = await resolveActiveOrg(me)
  // getMe() always bootstraps at least one membership, so this can't fire —
  // resolveActiveOrg is typed honestly (null when memberships is empty) so
  // we still guard rather than assert.
  if (!org) throw new Error('no organization membership')
  const list = await getCachedListDiagrams(org)
  // redirect() fires after this component has already suspended below the
  // Suspense boundary above, i.e. after the 200 OK has streamed — Next.js
  // turns this into a client-side redirect rather than an HTTP redirect
  // response. Acceptable here: the shell already painted instantly, and the
  // client-side hop to the real diagram id happens immediately after.
  if (list.length > 0) redirect(await serverEditorHref(list[0].id))
  // createDiagramRow, NOT createDiagram: this runs during RENDER, where the
  // action's revalidatePath is illegal (Next 16 throws) — and unnecessary,
  // since the redirect below re-renders the layout fresh regardless.
  const row = await createDiagramRow(org)
  redirect(await serverEditorHref(row.id))
}
