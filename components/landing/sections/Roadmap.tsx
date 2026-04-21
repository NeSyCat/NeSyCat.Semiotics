const ACC = '59, 130, 246'
const ACC_C = `rgb(${ACC})`

const COLS = [
  { tag: 'Now',      items: ['Shapes + points + lines', 'JSON round-trip', 'Kinds toggles', 'Selection glow'] },
  { tag: 'Next',     items: ['Auto-layout (dagre)', 'Copy-dots · Ω-nodes', 'Logic palette: ∧ ∨ ¬ ⇒ ⊕ ⊗'] },
  { tag: 'Later',    items: ['Haskell codegen', 'HaskTorch bindings', 'Presheaf view'] },
  { tag: 'Research', items: ['Tarski relations', 'Kleisli monads', 'Grammatical theory'] },
]

export default function Roadmap() {
  return (
    <section
      id="roadmap"
      style={{
        padding: '40px 48px 64px',
        borderTop: '1px solid var(--color-glass-border)',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <div className="t-caption" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
        § 4  Roadmap
      </div>
      <h2
        style={{
          margin: '14px 0 32px',
          fontSize: 28,
          fontWeight: 600,
          color: 'var(--color-text-primary)',
          letterSpacing: '-0.4px',
        }}
      >
        Where this is going.
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 24 }}>
        {COLS.map((col, i) => (
          <div key={col.tag}>
            <div
              className="t-mono"
              style={{
                fontSize: 11,
                color: i === 0 ? `rgba(${ACC},0.95)` : 'var(--color-text-muted)',
                fontWeight: 600,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              {col.tag}
            </div>
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
              {col.items.map((it) => (
                <div
                  key={it}
                  style={{
                    display: 'flex',
                    gap: 10,
                    alignItems: 'baseline',
                    fontSize: 14,
                    color: 'var(--color-text-secondary)',
                    lineHeight: 1.5,
                  }}
                >
                  <span
                    className="t-mono"
                    style={{
                      color: i === 0 ? ACC_C : 'var(--color-text-dimmed)',
                      fontSize: 10,
                    }}
                  >
                    ▸
                  </span>
                  <span>{it}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
