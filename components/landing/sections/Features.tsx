const ACC = '59, 130, 246'

const CARDS: Array<[string, string, string]> = [
  ['01', 'Shape primitives', 'Rectangle, triangle, circle, rhombus, and the empty carrier. Each shape has addressable points — total, side, and slot.'],
  ['02', 'Point wiring',     'Connect any point to any point. Lines carry names; edge labels render on solid dark capsules so math reads clean.'],
  ['03', 'JSON round-trip',  'Export, import, diff. Diagrams are pure data — versionable in git, reviewable in a PR, scriptable in Python.'],
  ['04', 'Haskell codegen',  'On the roadmap. Pipe diagrams into the NeSyCat/HaskTorch bindings and compile a presheaf straight to runnable code.'],
]

export default function Features() {
  return (
    <section
      style={{
        padding: '40px 48px 64px',
        borderTop: '1px solid var(--color-glass-border)',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <div className="t-caption" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
        § 2  Features
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
        Everything you need; nothing you don&apos;t.
      </h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16 }}>
        {CARDS.map(([n, t, d]) => (
          <div
            key={n}
            style={{
              padding: 20,
              border: '1px solid var(--color-glass-border)',
              borderRadius: 10,
              background: 'rgba(255,255,255,0.02)',
              minHeight: 180,
            }}
          >
            <div
              className="t-mono"
              style={{ fontSize: 11, color: `rgba(${ACC},0.9)`, fontWeight: 600, letterSpacing: '0.08em' }}
            >
              {n}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 16,
                fontWeight: 600,
                color: 'var(--color-text-primary)',
                letterSpacing: '-0.2px',
              }}
            >
              {t}
            </div>
            <div
              style={{
                marginTop: 10,
                fontSize: 13,
                color: 'var(--color-text-muted)',
                lineHeight: 1.55,
              }}
            >
              {d}
            </div>
          </div>
        ))}
      </div>
    </section>
  )
}
