import Logo from '../Logo'

export default function Footer() {
  return (
    <footer
      style={{
        padding: '28px 48px 36px',
        borderTop: '1px solid var(--color-glass-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        fontSize: 12,
        color: 'var(--color-text-dimmed)',
        maxWidth: 1200,
        margin: '0 auto',
        flexWrap: 'wrap',
        gap: 16,
      }}
    >
      <Logo />
      <div className="t-mono" style={{ display: 'flex', gap: 24 }}>
        <a href="https://github.com/NeSyCat/Diagrams/Diagrams" target="_blank" rel="noreferrer" style={linkStyle}>github.com/NeSyCat/Diagrams</a>
        <a href="#motivation" style={linkStyle}>docs</a>
        <a href="#cite" style={linkStyle}>paper.pdf</a>
        <span>MIT</span>
      </div>
      <span className="t-mono">v0.x · 2026</span>
    </footer>
  )
}

const linkStyle: React.CSSProperties = { color: 'inherit', textDecoration: 'none' }
