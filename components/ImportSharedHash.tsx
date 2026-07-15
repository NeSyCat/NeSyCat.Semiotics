'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { decodeDiagramFromFragment } from '@/components/editor2/share'
import { createDiagram, saveDiagram } from '@/lib/actions/diagrams'

interface Props {
  editorHrefBase: string
}

// Module-level guard against StrictMode's double-invoked dev effect — the
// import must only ever run once per page load.
let ranOnce = false

// editorHrefBase is serverEditorHref() called with no id — '/' (subdomain),
// 'https://semiotics.nesycat.org/' (apex), or '/editor' (single-host).
// Normalize the trailing slash so appending '/<id>' matches
// editorHrefForHost(host, id) exactly in all three modes.
function hrefFor(base: string, id: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return `${trimmed}/${id}`
}

// Signed-in `#d=` import: mounted only in the signed-in editor layout branch.
// If the URL carries a shared-diagram fragment, decode it, create a new row
// ("Shared diagram"), save the decoded data into it, then replace the URL to
// the new diagram (clearing the fragment, so refresh never re-imports and
// autosave can never write shared content back over a DB row). The store is
// never hydrated from the hash on a signed-in diagram page, so this is the
// only path shared content can reach the DB from. Decode failure -> silent
// no-op (renders nothing either way).
export default function ImportSharedHash({ editorHrefBase }: Props) {
  const router = useRouter()

  useEffect(() => {
    if (ranOnce) return
    if (!location.hash.startsWith('#d=')) return
    ranOnce = true
    // No cancellation on unmount: `ranOnce` makes this run-once-per-pageload,
    // and StrictMode's dev unmount/remount must not abort the one run that
    // started (a cancelled first run + guarded second run would silently skip
    // the import). router.replace is safe after unmount — the app router is
    // a stable global.
    ;(async () => {
      const decoded = await decodeDiagramFromFragment(location.hash)
      if (!decoded) return
      const row = await createDiagram('Shared diagram')
      await saveDiagram(row.id, decoded)
      router.replace(hrefFor(editorHrefBase, row.id))
    })().catch((err) => {
      console.error('shared-diagram import failed', err)
    })
  }, [editorHrefBase, router])

  return null
}
