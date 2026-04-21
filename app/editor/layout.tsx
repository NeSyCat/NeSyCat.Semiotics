import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { listDiagrams } from '@/lib/actions/diagrams'
import EditorSidebar from '@/components/editor/EditorSidebar'

export default async function EditorLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/')

  const diagrams = await listDiagrams()

  return (
    <div className="flex h-screen w-screen">
      <EditorSidebar diagrams={diagrams} />
      <main className="relative flex-1">{children}</main>
    </div>
  )
}
