import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { serverEditorHref } from '@/lib/editor-url'
import SignInLanding from '@/components/SignInLanding'

// This app is the Semiotics editor only — the umbrella site (nesycat.org)
// lives in the sibling repo `NeSyCat.Web`. Authenticated users skip straight
// to /editor; unauthenticated users get the sign-in landing.
export default async function Root() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    redirect(await serverEditorHref())
  }
  return <SignInLanding />
}
