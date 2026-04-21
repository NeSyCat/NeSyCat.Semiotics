import SignInButton from '../SignInButton'

interface Props {
  isSignedIn: boolean
  editorHref: string
  callbackUrl: string
}

export default function FinalCTA({ isSignedIn, editorHref, callbackUrl }: Props) {
  return (
    <section
      id="cite"
      style={{
        padding: 48,
        borderTop: '1px solid var(--color-glass-border)',
        maxWidth: 1200,
        margin: '0 auto',
        display: 'grid',
        gridTemplateColumns: '1.2fr 1fr',
        gap: 48,
        alignItems: 'center',
      }}
    >
      <div>
        <h2
          style={{
            margin: 0,
            fontSize: 40,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            letterSpacing: '-0.8px',
            lineHeight: 1.1,
            textWrap: 'balance',
          }}
        >
          Ready to wire your first diagram?
        </h2>
        <p
          style={{
            margin: '18px 0 0',
            color: 'var(--color-text-muted)',
            fontSize: 16,
            lineHeight: 1.6,
            maxWidth: 520,
          }}
        >
          Launches in-browser. Sign in to save your diagrams to your account.
        </p>
        <div style={{ marginTop: 28, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <SignInButton isSignedIn={isSignedIn} editorHref={editorHref} callbackUrl={callbackUrl} big />
          <a href="#motivation" style={secondaryBig}>Read docs</a>
        </div>
      </div>
      <div>
        <div className="t-caption" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
          § 5  Cite
        </div>
        <pre
          className="t-mono"
          style={{
            marginTop: 12,
            padding: 18,
            border: '1px solid var(--color-glass-border)',
            borderRadius: 10,
            background: 'rgba(255,255,255,0.02)',
            fontSize: 12,
            color: 'var(--color-text-secondary)',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
          }}
        >
{`// bibtex
@software{nesycat2026,
  title  = {NeSyCat Diagrams},
  author = {NeSyCat contributors},
  year   = {2026},
  url    = {https://github.com/NeSyCat/Diagrams}
}`}
        </pre>
      </div>
    </section>
  )
}

const secondaryBig: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 8,
  padding: '14px 24px',
  border: '1px solid var(--color-glass-border)',
  borderRadius: 8,
  background: 'var(--color-glass-button-bg)',
  color: 'var(--color-text-secondary)',
  fontSize: 15,
  fontWeight: 600,
  textDecoration: 'none',
  backdropFilter: 'blur(3px)',
  WebkitBackdropFilter: 'blur(3px)',
}
