import type { InputHTMLAttributes } from 'react'

type TextFieldProps = InputHTMLAttributes<HTMLInputElement>

export function TextField({ className, type = 'text', ...rest }: TextFieldProps) {
  return (
    <input
      type={type}
      {...rest}
      className={
        className ??
        'w-[280px] h-[40px] px-[14px] py-[10px] text-[14px] text-[color:var(--color-text-primary)] placeholder:text-[color:var(--color-muted-foreground)] bg-[color:var(--color-surface)] border border-[color:var(--color-border)] rounded-[var(--radius-sm)] outline-none focus:border-[color:var(--color-primary)] transition-colors'
      }
      data-node-id="5:11"
      data-name="TextField"
    />
  )
}

export default TextField
