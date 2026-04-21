import type { ReactNode } from 'react'

type CheckboxProps = {
  checked?: boolean
  onChange?: (checked: boolean) => void
  label?: ReactNode
  className?: string
  disabled?: boolean
}

const BOX_BASE =
  'inline-flex items-center justify-center size-[18px] rounded-[var(--size-radius-sm)] border-[1.5px] cursor-pointer transition-all outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--color-accent-blue)]'

const BOX_UNCHECKED =
  'bg-[color:var(--color-glass-button-bg)] border-[color:var(--color-glass-border)]'

const BOX_CHECKED =
  'bg-[color:var(--color-accent-blue)] border-[color:var(--color-accent-blue)] shadow-[0_0_6px_rgba(59,130,246,0.6)]'

export function Checkbox({ checked = false, onChange, label, className, disabled }: CheckboxProps) {
  const box = (
    <span
      role="checkbox"
      aria-checked={checked}
      aria-disabled={disabled || undefined}
      tabIndex={disabled ? -1 : 0}
      onClick={() => !disabled && onChange?.(!checked)}
      onKeyDown={(e) => {
        if (disabled) return
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onChange?.(!checked)
        }
      }}
      className={className ?? `${BOX_BASE} ${checked ? BOX_CHECKED : BOX_UNCHECKED} ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
      data-node-id={checked ? '5:14' : '5:13'}
      data-name={`Checkbox / ${checked ? 'Checked' : 'Unchecked'}`}
    >
      {checked && (
        <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden>
          <path d="M3 9 L7 13 L13 4" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  )

  if (label == null) return box

  return (
    <label className="inline-flex items-center gap-2 cursor-pointer select-none text-[color:var(--color-text-primary)] text-[14px]">
      {box}
      {label}
    </label>
  )
}

export default Checkbox
