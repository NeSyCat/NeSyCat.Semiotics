import { serverCallbackUrl, serverEditorHref } from '@/lib/editor-url'
import Logo from '@/components/Logo'
import SignInButton from '@/components/SignInButton'

const ACC = '52, 120, 246'

// The Semiotics editor's own sign-in surface for anonymous visitors — shown
// both at the apex (app/page.tsx) and, in place, to unauthenticated visitors
// on the editor subdomain itself (app/editor/layout.tsx), so landing on
// semiotics.nesycat.org always stays on this app rather than bouncing to the
// umbrella site's domain.
export default async function SignInLanding() {
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
          color: 'var(--color-muted-foreground)',
          fontSize: 15,
          lineHeight: 1.55,
        }}
      >
        Compose string diagrams, wire their points, round-trip JSON.
      </p>
      <SignInButton isSignedIn={false} editorHref={editorHref} callbackUrl={callbackUrl} big />
      <a
        href="https://nesycat.org"
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
