import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { serverCallbackUrl, serverEditorHref } from '@/lib/editor-url'
import Logo from '@/components/Logo'
import SignInButton from '@/components/SignInButton'

const ACC = '59, 130, 246'

// This app is the Semiotics editor only — the umbrella site (nesycat.com)
// lives in the sibling repo `NeSyCat.Web`. Authenticated users skip straight
// to /editor; unauthenticated users get a one-screen sign-in surface plus a
// link out to the umbrella.
export default async function Root() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) {
    redirect(await serverEditorHref())
  }
  const callbackUrl = await serverCallbackUrl()
  const editorHref = await serverEditorHref()

  return (
    <main
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: '48px 24px',
      }}
    >
      <Logo />
      <h1
        className="t-display"
        style={{ margin: 0, textAlign: 'center', textWrap: 'balance' }}
      >
        Semiotics editor
      </h1>
      <p
        style={{
          margin: 0,
          maxWidth: 460,
          textAlign: 'center',
          color: 'var(--color-text-muted)',
          fontSize: 15,
          lineHeight: 1.55,
        }}
      >
        Compose string diagrams, wire their points, round-trip JSON.
      </p>
      <SignInButton isSignedIn={false} editorHref={editorHref} callbackUrl={callbackUrl} big />
      <a
        href="https://nesycat.com"
        target="_blank"
        rel="noreferrer"
        className="t-mono"
        style={{
          fontSize: 12,
          color: `rgba(${ACC},0.85)`,
          textDecoration: 'none',
          marginTop: 8,
        }}
      >
        Read about NeSyCat ↗
      </a>
    </main>
  )
}
