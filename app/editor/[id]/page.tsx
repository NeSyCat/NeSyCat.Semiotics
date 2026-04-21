import { notFound } from 'next/navigation'
import CanvasRoot from '@/components/editor/Canvas'
import { loadDiagram } from '@/lib/actions/diagrams'
import type { DiagramData } from '@/components/editor/types'

export default async function EditorDiagramPage(props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params
  const row = await loadDiagram(id)
  if (!row) notFound()
  return <CanvasRoot diagramId={id} initialData={row.data as DiagramData} />
}
