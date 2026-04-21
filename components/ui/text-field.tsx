import type { InputHTMLAttributes } from 'react'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement>

export function TextField({ className, type = 'text', ...rest }: TextFieldProps) {
  return (
    <input
      type={type}
      {...rest}
      className={
        className ??
        'w-[280px] h-[40px] px-[14px] py-[10px] text-[14px] text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-text-muted)] bg-[color:var(--color-glass-button-bg)] border border-[color:var(--color-glass-border)] rounded-[var(--size-radius-md)] outline-none focus:border-[color:var(--color-accent-blue)] transition-colors'
      }
      data-node-id="5:11"
      data-name="TextField"
    />
  )
}

export default TextField
