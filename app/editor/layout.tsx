import { getAuthUser } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/supabase/env'
import { getCachedMe, getCachedListDiagrams } from '@/lib/actions/read-cache'
import { resolveActiveOrg } from '@/lib/active-org'
import { serverEditorHref } from '@/lib/editor-url.server'
import EditorSidebar from '@/components/EditorSidebar'
import StarPrompt from '@/components/StarPrompt'
import ImportSharedHash from '@/components/ImportSharedHash'

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  // No Supabase env (CI, fresh checkout) → nobody can be signed in; render
  // the anonymous shell instead of crashing on client creation.
  // See lib/supabase/env.ts.
  const user = supabaseConfigured() ? await getAuthUser() : null
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

  const me = await getCachedMe()
  const org = await resolveActiveOrg(me)
  // getMe() always bootstraps at least one membership (see app/editor/page.tsx).
  if (!org) throw new Error('no organization membership')
  const diagrams = await getCachedListDiagrams(org)

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <main className="absolute inset-0">{children}</main>
      <EditorSidebar diagrams={diagrams} activeOrgId={org} />
      <StarPrompt repoUrl="https://github.com/cherryfunk/semiotics.nesycat" />
      <ImportSharedHash editorHrefBase={await serverEditorHref()} />
    </div>
  )
}
