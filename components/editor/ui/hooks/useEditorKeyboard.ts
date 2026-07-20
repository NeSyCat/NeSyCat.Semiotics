import { useEffect } from 'react'
import { useStore } from '../../state/store'

// Keyboard: undo/redo (Cmd/Ctrl+Z, +Shift for redo) + delete selected points
// (Delete/Backspace). Ignored while typing in a text field. Reads store state
// fresh on each keypress via getState() (not a subscription), so this hook
// takes no reactive dependencies of its own.
export function useEditorKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (e.key === 'z' && (e.metaKey || e.ctrlKey)) {
        if (typing) return
        e.preventDefault()
        if (e.shiftKey) useStore.getState().redo()
        else useStore.getState().undo()
        return
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (typing) return
        const pts = useStore.getState().selectedPoints
        if (pts.length === 0) return
        e.preventDefault()
        e.stopPropagation()
        for (const id of pts) useStore.getState().removePoint(id)
        useStore.getState().clearSelection()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
}
