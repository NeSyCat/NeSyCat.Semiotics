'use client'

import { memo, useState, useRef, useEffect, useMemo } from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getStraightPath,
  getSmoothStepPath,
  type EdgeProps,
} from '@xyflow/react'
import theme from './theme'
import { useStore } from './store'

interface LineEdgeData {
  label: string
  onRename: (name: string) => void
}

function LineEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  data,
  selected,
  markerEnd,
}: EdgeProps) {
  const d = data as unknown as LineEdgeData
  const mode = useStore((s) => s.edgePath)

  const [edgePath, labelX, labelY] = mode === 'smoothstep'
    ? getSmoothStepPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
    : getStraightPath({ sourceX, sourceY, targetX, targetY })

  const [editing, setEditing] = useState(false)
  const [editText, setEditText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
    }
  }, [editing])

  function commit() {
    const name = editText.trim()
    if (name && name !== d.label) d.onRename(name)
    setEditing(false)
  }

  const edgeStyle = useMemo(
    () => ({
      stroke: selected ? `rgba(${theme.node.accentBlue}, 1)` : `rgba(${theme.node.accentBlue}, 0.5)`,
      strokeWidth: selected ? 2.5 : 1.5,
      transition: 'stroke 0.15s ease, stroke-width 0.15s ease',
    }),
    [selected],
  )

  const labelBase: React.CSSProperties = {
    background: 'var(--color-card)',
    borderRadius: 3,
    padding: '2px 8px',
    color: selected ? theme.text.primary : theme.text.secondary,
    fontSize: theme.smallFontSize,
    fontFamily: "'SF Mono', Menlo, monospace",
    border: selected ? `1px solid rgba(${theme.node.accentBlue}, 0.7)` : '1px solid var(--color-border)',
    boxSizing: 'border-box',
    lineHeight: 1.3,
    textAlign: 'center',
  }

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={edgeStyle} />
      <EdgeLabelRenderer>
        <div
          className="nodrag nopan"
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px, ${labelY}px)`,
            pointerEvents: 'all',
          }}
          onDoubleClick={(e) => {
            e.stopPropagation()
            if (!editing) {
              setEditText(d.label)
              setEditing(true)
            }
          }}
        >
          {editing ? (
            <input
              ref={inputRef}
              value={editText}
              onChange={(e) => setEditText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit()
                if (e.key === 'Escape') setEditing(false)
              }}
              onBlur={commit}
              size={Math.max(1, editText.length)}
              style={{ ...labelBase, outline: 'none' }}
            />
          ) : (
            <span style={{ ...labelBase, display: 'inline-block', cursor: 'text', userSelect: 'none' }}>
              {d.label}
            </span>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  )
}

export default memo(LineEdge)
