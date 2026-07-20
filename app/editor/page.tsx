import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { createDiagram, listDiagrams } from '@/lib/actions/diagrams'
import { serverCallbackUrl, serverEditorHref } from '@/lib/editor-url'
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
          <AuthSharePill isSignedIn={false} callbackUrl={await serverCallbackUrl()} shareBase={await serverEditorHref()} />
        }
      />
    )
  }

  const list = await listDiagrams()
  if (list.length > 0) redirect(await serverEditorHref(list[0].id))
  const row = await createDiagram()
  redirect(await serverEditorHref(row.id))
}
