'use client'

import { createClient } from '@/lib/supabase/client'

export async function startGitHubSignIn(callbackUrl: string) {
  const supabase = createClient()
  const redirectTo = callbackUrl.startsWith('http') ? callbackUrl : `${window.location.origin}${callbackUrl}`
  await supabase.auth.signInWithOAuth({
    provider: 'github',
    options: { redirectTo },
  })
}
