import type { HTMLAttributes, ReactNode } from 'react'

type MenuItemProps = Omit<HTMLAttributes<HTMLDivElement>, 'role'> & {
  selected?: boolean
  children: ReactNode
}

const BASE =
  'flex items-center gap-[10px] w-[240px] h-[36px] px-[14px] py-[10px] rounded-[var(--size-radius-sm)] text-[14px] text-[color:var(--color-text-primary)] cursor-pointer transition-colors'

const SELECTED = 'bg-[color:var(--color-glass-button-bg)]'
const DEFAULT  = 'hover:bg-[color:var(--color-glass-button-bg)]'

export function MenuItem({ selected = false, className, children, ...rest }: MenuItemProps) {
  return (
    <div
      role="menuitem"
      aria-selected={selected}
      {...rest}
      className={className ?? `${BASE} ${selected ? SELECTED : DEFAULT}`}
      data-node-id={selected ? '5:19' : '5:16'}
      data-name={`MenuItem / ${selected ? 'Selected' : 'Default'}`}
    >
      {selected ? (
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
          style={{ filter: 'drop-shadow(0 0 4px rgba(59,130,246,0.7))' }}
        >
          <path d="M2 7 L6 11 L12 2" stroke="var(--color-accent-blue)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <span className="shrink-0 size-[14px]" aria-hidden />
      )}
      {children}
    </div>
  )
}

export default MenuItem
