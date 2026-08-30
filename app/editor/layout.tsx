import { Suspense } from 'react'
import { getAuthUser } from '@/lib/supabase/server'
import { supabaseConfigured } from '@/lib/supabase/env'
import { getCachedMe, getCachedListDiagrams } from '@/lib/actions/read-cache'
import { resolveActiveOrg } from '@/lib/active-org'
import { serverEditorHref } from '@/lib/editor-url.server'
import EditorSidebar from '@/components/EditorSidebar'
import StarPrompt from '@/components/StarPrompt'
import ImportSharedHash from '@/components/ImportSharedHash'

// The frame itself (this div/main wrapper) and StarPrompt (static props,
// no auth dependency) don't await anything, so with cacheComponents this
// becomes the build-time static shell. Everything that depends on the
// session — getAuthUser, and the sidebar/import data that only exists for
// signed-in users — moves into AuthedExtras below, wrapped in <Suspense>.
// fallback={null} because, unlike the page-level LoadingScreen fallbacks,
// there's no meaningful skeleton for "sidebar that may or may not exist" —
// anonymous visitors see nothing here today, and that's exactly what the
// fallback renders while the authed branch resolves.
export default function EditorLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <main className="absolute inset-0">{children}</main>
      <Suspense fallback={null}>
        <AuthedExtras />
      </Suspense>
      <StarPrompt repoUrl="https://github.com/cherryfunk/semiotics.nesycat" />
    </div>
  )
}

async function AuthedExtras() {
  // No Supabase env (CI, fresh checkout) → nobody can be signed in; render
  // nothing extra instead of crashing on client creation. See lib/supabase/env.ts.
  const user = supabaseConfigured() ? await getAuthUser() : null
  // Anonymous visitors get the same shell minus the sidebar — the editor
  // itself (AnonymousEditor, resolved by app/editor/page.tsx) runs auth-free,
  // keeping its data in localStorage / the URL fragment instead of the DB.
  if (!user) return null

  const me = await getCachedMe()
  const org = await resolveActiveOrg(me)
  // getMe() always bootstraps at least one membership (see app/editor/page.tsx).
  if (!org) throw new Error('no organization membership')
  const diagrams = await getCachedListDiagrams(org)

  return (
    <>
      <EditorSidebar diagrams={diagrams} activeOrgId={org} />
      <ImportSharedHash editorHrefBase={await serverEditorHref()} />
    </>
  )
}
