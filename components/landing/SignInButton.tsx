'use client'

import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import type { ReactNode } from 'react'

export type SignInVariant = 'primary' | 'secondary'

interface Props {
  isSignedIn: boolean
  editorHref: string
  callbackUrl: string
  variant?: SignInVariant
  big?: boolean
  label?: string
  icon?: ReactNode
  suffix?: string
}

const ACC = '59, 130, 246'

function btnStyle(variant: SignInVariant, big?: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: big ? '14px 24px' : '9px 16px',
    border: `1px solid ${variant === 'primary' ? `rgba(${ACC},0.7)` : 'var(--color-glass-border)'}`,
    borderRadius: 8,
    background: variant === 'primary' ? `rgba(${ACC},0.22)` : 'var(--color-glass-button-bg)',
    color: variant === 'primary' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
    fontSize: big ? 15 : 13,
    fontWeight: 600,
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    backdropFilter: 'blur(3px)',
    WebkitBackdropFilter: 'blur(3px)',
    boxShadow: variant === 'primary' ? `0 0 0 4px rgba(${ACC},0.08)` : 'none',
    transition: 'background .15s, border-color .15s',
    textDecoration: 'none',
    fontFamily: 'inherit',
  }
}

export function GitHubIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M8 0C3.58 0 0 3.58 0 8a8 8 0 005.47 7.59c.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0016 8c0-4.42-3.58-8-8-8z" />
    </svg>
  )
}

export default function SignInButton({
  isSignedIn,
  editorHref,
  callbackUrl,
  variant = 'primary',
  big,
  label,
  icon = <GitHubIcon size={big ? 17 : 15} />,
  suffix,
}: Props) {
  const style = btnStyle(variant, big)

  if (isSignedIn) {
    return (
      <Link href={editorHref} style={style}>
        {icon}
        {label ?? 'Open editor'}
        {suffix && <span style={{ opacity: 0.7, fontSize: big ? 14 : 12 }}>{suffix ?? '→'}</span>}
      </Link>
    )
  }

  const onClick = async () => {
    const supabase = createClient()
    const redirectTo = callbackUrl.startsWith('http') ? callbackUrl : `${window.location.origin}${callbackUrl}`
    await supabase.auth.signInWithOAuth({
      provider: 'github',
      options: { redirectTo },
    })
  }

  return (
    <button type="button" onClick={onClick} style={style}>
      {icon}
      {label ?? 'Sign in with GitHub'}
      {suffix && <span style={{ opacity: 0.7, fontSize: big ? 14 : 12 }}>{suffix}</span>}
    </button>
  )
}
