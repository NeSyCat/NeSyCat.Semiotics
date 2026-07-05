import { createClient } from '@/lib/supabase/server'
import { listDiagrams } from '@/lib/actions/diagrams'
import EditorSidebar from '@/components/EditorSidebar'
import StarPrompt from '@/components/StarPrompt'
import SignInLanding from '@/components/SignInLanding'

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  // Unauthenticated visitors get the sign-in landing in place — this stays on
  // whatever host they arrived on (e.g. semiotics.nesycat.org) rather than
  // bouncing off-domain to the umbrella site.
  if (!user) return <SignInLanding />

  const diagrams = await listDiagrams()

  return (
    <div className="relative h-screen w-screen overflow-hidden">
      <main className="absolute inset-0">{children}</main>
      <EditorSidebar diagrams={diagrams} />
      <StarPrompt repoUrl="https://github.com/cherryfunk/semiotics.nesycat" />
    </div>
  )
}
