export default function Motivation() {
  return (
    <section
      id="motivation"
      style={{
        padding: '64px 48px',
        borderTop: '1px solid var(--color-glass-border)',
        maxWidth: 1200,
        margin: '0 auto',
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 64, alignItems: 'start' }}>
        <div>
          <div className="t-caption" style={{ color: 'var(--color-text-muted)', letterSpacing: '0.08em' }}>
            § 1  Motivation
          </div>
          <h2
            style={{
              margin: '14px 0 0',
              fontSize: 32,
              fontWeight: 600,
              color: 'var(--color-text-primary)',
              letterSpacing: '-0.5px',
              lineHeight: 1.2,
              textWrap: 'balance',
            }}
          >
            Domain theory, drawn.
          </h2>
        </div>
        <div style={{ color: 'var(--color-text-secondary)', fontSize: 16, lineHeight: 1.7 }}>
          <p style={{ margin: 0 }}>
            NeSyCat — <em>Neuro-Symbolic Category</em> — sits at the intersection of category theory,
            deep learning, and formal logic. Researchers already think in string diagrams. The editor
            just gives those diagrams a live canvas and a JSON spine so they can feed a codegen pipeline.
          </p>
          <p style={{ margin: '18px 0 0' }}>
            The tool is deliberately narrow: four shape primitives, one empty carrier, two edge modes,
            no chrome beyond Kinds and JSON. The canvas <em>is</em> the product.
          </p>
        </div>
      </div>
    </section>
  )
}
