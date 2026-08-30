import { Suspense } from 'react'
import { redirect } from 'next/navigation'
import { serverEditorHref } from '@/lib/editor-url.server'

// This app is the Semiotics editor only — the umbrella site (nesycat.org)
// lives in the sibling repo `NeSyCat.Web`. Anonymous-first: every visitor
// lands straight in a diagram editor, no login wall.
//
// The entire route is a host-aware redirect: serverEditorHref() reads the
// Host header via next/headers, so there is no static content to hoist above
// it — this is the "fully dynamic, tiny route" case. Per the Cache Components
// streaming guide's "push dynamic access down" pattern, the dynamic work
// moves into a child wrapped in Suspense (fallback={null}, since nothing
// ever renders here — the redirect fires before any UI would). The redirect
// then fires below the boundary, so — like every redirect() under Suspense —
// it becomes a client-side redirect instead of an HTTP 3xx response; since
// this route has no content of its own, the extra hop is imperceptible.
export default function Root() {
  return (
    <Suspense fallback={null}>
      <RedirectToEditor />
    </Suspense>
  )
}

async function RedirectToEditor(): Promise<never> {
  redirect(await serverEditorHref())
}
