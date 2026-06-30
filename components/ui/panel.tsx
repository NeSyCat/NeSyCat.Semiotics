import type { HTMLAttributes, ReactNode } from 'react'

type PanelProps = HTMLAttributes<HTMLDivElement> & { children?: ReactNode }

export function Panel({ className, children, ...rest }: PanelProps) {
  return (
    <div
      {...rest}
      className={
        className ??
        'flex flex-col gap-3 p-6 bg-[color:var(--color-card)] border border-[color:var(--color-border)] rounded-[var(--radius-md)]'
      }
      data-node-id="5:9"
      data-name="Panel"
    >
      {children}
    </div>
  )
}

export default Panel
