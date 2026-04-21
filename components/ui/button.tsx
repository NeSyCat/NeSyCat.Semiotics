import type { ButtonHTMLAttributes, ReactNode } from 'react'

type ButtonVariant = 'primary' | 'ghost'

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant
  children?: ReactNode
}

const BASE =
  'inline-flex items-center justify-center h-[30px] px-4 text-[13px] font-semibold text-[color:var(--color-text-primary)] rounded-[var(--size-radius-md)] transition-colors cursor-pointer'

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-[color:var(--color-accent-blue)] hover:opacity-90',
  ghost:   'border border-[color:var(--color-glass-border)] hover:bg-[color:var(--color-glass-button-bg)]',
}

const FIGMA_NODE: Record<ButtonVariant, string> = {
  primary: '2:2',
  ghost:   '5:22',
}

export function Button({ variant = 'primary', className, children = 'Button', ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      {...rest}
      className={className ?? `${BASE} ${VARIANT[variant]}`}
      data-node-id={FIGMA_NODE[variant]}
      data-name={`Button / ${variant === 'primary' ? 'Primary' : 'Ghost'}`}
    >
      {children}
    </button>
  )
}

export default Button
