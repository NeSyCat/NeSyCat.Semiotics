import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createDiagram, listDiagrams } from '@/lib/actions/diagrams'
import { getMe } from '@/lib/actions/organizations'
import { resolveActiveOrg } from '@/lib/active-org'
import { serverCallbackUrl, serverEditorHref } from '@/lib/editor-url.server'
import AnonymousEditor from '@/components/editor/AnonymousEditor'
import AuthSharePill from '@/components/AuthSharePill'

export default async function EditorIndex() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
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

  const me = await getMe()
  const org = await resolveActiveOrg(me)
  // getMe() always bootstraps at least one membership, so this can't fire —
  // resolveActiveOrg is typed honestly (null when memberships is empty) so
  // we still guard rather than assert.
  if (!org) throw new Error('no organization membership')
  const list = await listDiagrams(org)
  if (list.length > 0) redirect(await serverEditorHref(list[0].id))
  const row = await createDiagram(org)
  redirect(await serverEditorHref(row.id))
}
