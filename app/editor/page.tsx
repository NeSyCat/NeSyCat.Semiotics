import { redirect } from 'next/navigation'
import { getAuthUser } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/supabase/env'
import { createDiagram } from '@/lib/actions/diagrams'
import { getCachedMe, getCachedListDiagrams } from '@/lib/actions/read-cache'
import { resolveActiveOrg } from '@/lib/active-org'
import { serverCallbackUrl, serverEditorHref } from '@/lib/editor-url.server'
import AnonymousEditor from '@/components/editor/AnonymousEditor'
import AuthSharePill from '@/components/AuthSharePill'

export default async function EditorIndex() {
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
  if (list.length > 0) redirect(await serverEditorHref(list[0].id))
  const row = await createDiagram(org)
  redirect(await serverEditorHref(row.id))
}
