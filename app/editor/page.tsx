import { redirect } from 'next/navigation'
import { createDiagram, listDiagrams } from '@/lib/actions/diagrams'

export default async function EditorIndex() {
  const list = await listDiagrams()
  if (list.length > 0) redirect(`/editor/${list[0].id}`)
  const id = await createDiagram()
  redirect(`/editor/${id}`)
}
