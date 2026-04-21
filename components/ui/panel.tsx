import type { HTMLAttributes, ReactNode } from 'react'

type PanelProps = HTMLAttributes<HTMLDivElement> & { children?: ReactNode }

export function Panel({ className, children, ...rest }: PanelProps) {
  return (
    <div
      {...rest}
      className={
        className ??
        'flex flex-col gap-3 p-6 backdrop-blur-[3px] bg-[color:var(--color-glass-panel-bg)] border border-[color:var(--color-glass-border)] rounded-[var(--size-radius-lg)]'
      }
      data-node-id="5:9"
      data-name="Panel"
    >
      {children}
    </div>
  )
}

export default Panel
