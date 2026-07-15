import { createClient } from '@/lib/supabase/server'
import { listDiagrams } from '@/lib/actions/diagrams'
import { serverEditorHref } from '@/lib/editor-url'
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

  const diagrams = await listDiagrams()

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <main className="absolute inset-0">{children}</main>
      <EditorSidebar diagrams={diagrams} />
      <StarPrompt repoUrl="https://github.com/cherryfunk/semiotics.nesycat" />
      <ImportSharedHash editorHrefBase={await serverEditorHref()} />
    </div>
  )
}
