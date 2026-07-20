import { redirect } from 'next/navigation'
import { serverEditorHref } from '@/lib/editor-url.server'

// This app is the Semiotics editor only — the umbrella site (nesycat.org)
// lives in the sibling repo `NeSyCat.Web`. Anonymous-first: every visitor
// lands straight in a diagram editor, no login wall.
export default async function Root() {
  redirect(await serverEditorHref())
}
