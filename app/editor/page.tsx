import { redirect } from 'next/navigation'
import { createDiagram, listDiagrams } from '@/lib/actions/diagrams'
import { serverEditorHref } from '@/lib/editor-url'

export default async function EditorIndex() {
  const list = await listDiagrams()
  if (list.length > 0) redirect(await serverEditorHref(list[0].id))
  const id = await createDiagram()
  redirect(await serverEditorHref(id))
}
