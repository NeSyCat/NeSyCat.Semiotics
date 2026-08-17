import { createClient } from '@/lib/supabase/server'
import { listDiagrams } from '@/lib/actions/diagrams'
import { getMe } from '@/lib/actions/organizations'
import { resolveActiveOrg } from '@/lib/active-org'
import { serverEditorHref } from '@/lib/editor-url.server'
import EditorSidebar from '@/components/EditorSidebar'
import StarPrompt from '@/components/StarPrompt'
import ImportSharedHash from '@/components/ImportSharedHash'

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Anonymous visitors get the same shell minus the sidebar — the editor
  // itself (AnonymousEditor, resolved by app/editor/page.tsx) runs auth-free,
  // keeping its data in localStorage / the URL fragment instead of the DB.
  if (!user) {
    return (
      <div className="relative h-screen w-screen overflow-hidden">
        <main className="absolute inset-0">{children}</main>
        <StarPrompt repoUrl="https://github.com/cherryfunk/semiotics.nesycat" />
      </div>
    )
  }

  const me = await getMe()
  const org = await resolveActiveOrg(me)
  // getMe() always bootstraps at least one membership (see app/editor/page.tsx).
  if (!org) throw new Error('no organization membership')
  const diagrams = await listDiagrams(org)

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <main className="absolute inset-0">{children}</main>
      <EditorSidebar diagrams={diagrams} activeOrgId={org} />
      <StarPrompt repoUrl="https://github.com/cherryfunk/semiotics.nesycat" />
      <ImportSharedHash editorHrefBase={await serverEditorHref()} />
    </div>
  )
}
