import { describe, expect, it } from 'vitest'
import { diagramToPrisma } from '../../components/editor/export/prisma'
import type { Diagram } from '../../components/editor/domain/types'

// Glyph legend: rhombus = max 1 (single), square = max ∞ (list); filled (color)
// = min 0 (optional). The TYPE is read from the target; the source carries no
// type (blank). A discriminated union is a coproduct TRIANGLE: its peak carries
// the discriminator wire (base → peak), its base ('c') the variant injections.
const mt = (s: string) => `\\mathtt{${s}}`
const BLACK: [number, number, number] = [0, 0, 0]

describe('diagramToPrisma', () => {
  const d: Diagram = {
    schemaVersion: 1,
    forms: [
      { id: 'U', shape: 'square', name: mt('User'), position: { x: 0, y: 0 }, edges: { left: ['u_name', 'u_bio'], right: ['u_rel'], bottom: ['u_addr'] } },
      { id: 'P', shape: 'square', name: mt('Post'), position: { x: 600, y: 0 }, edges: { left: ['p_rel'], right: ['p_title'], bottom: ['p_kind'] } },
      { id: 'A', shape: 'square', name: mt('Article'), position: { x: 600, y: 500 }, edges: { top: ['a_inj'], left: ['a_sum'] } },
      { id: 'K', shape: 'triangle', rotation: 270, name: mt('Kind'), position: { x: 600, y: 260 }, edges: { peak: ['k_peak'], c: ['k_base'] } },
      { id: 'ADDR', shape: 'circle', name: mt('Address'), position: { x: 0, y: 500 }, edges: { up: ['addr_in'], down: ['addr_street'] } },
      // leaf type-nodes
      { id: 'TN1', shape: 'empty', position: { x: -300, y: -50 }, edges: { self: ['tn_name'] } },
      { id: 'TN2', shape: 'empty', position: { x: -300, y: 50 }, edges: { self: ['tn_bio'] } },
      { id: 'TN3', shape: 'empty', position: { x: 900, y: 0 }, edges: { self: ['tn_title'] } },
      { id: 'TN4', shape: 'empty', position: { x: 400, y: 500 }, edges: { self: ['tn_sum'] } },
      { id: 'TN5', shape: 'empty', position: { x: -300, y: 550 }, edges: { self: ['tn_street'] } },
    ],
    points: {
      // sources on models: blank name, square glyph (no @unique on scalars)
      u_name: { id: 'u_name', shape: 'square', formId: 'U', edgeKey: 'left' },
      u_bio: { id: 'u_bio', shape: 'square', formId: 'U', edgeKey: 'left' },
      u_rel: { id: 'u_rel', shape: 'rhombus', formId: 'U', edgeKey: 'right', name: mt('Post') }, // author target on User: ◇ → required
      u_addr: { id: 'u_addr', shape: 'square', formId: 'U', edgeKey: 'bottom' },
      p_rel: { id: 'p_rel', shape: 'square', color: BLACK, formId: 'P', edgeKey: 'left' }, // ■ many reverse → no @unique
      p_title: { id: 'p_title', shape: 'square', formId: 'P', edgeKey: 'right' },
      p_kind: { id: 'p_kind', shape: 'square', formId: 'P', edgeKey: 'bottom' },
      a_inj: { id: 'a_inj', shape: 'rhombus', color: BLACK, formId: 'A', edgeKey: 'top' },
      a_sum: { id: 'a_sum', shape: 'square', formId: 'A', edgeKey: 'left' },
      // triangle Kind: peak = discriminator (String), base = injection target
      k_peak: { id: 'k_peak', shape: 'rhombus', formId: 'K', edgeKey: 'peak', name: mt('String') },
      k_base: { id: 'k_base', shape: 'rhombus', formId: 'K', edgeKey: 'c', name: mt('Post') },
      // circle Address: in-port + one field port
      addr_in: { id: 'addr_in', shape: 'rhombus', color: BLACK, formId: 'ADDR', edgeKey: 'up' }, // ◆ → address Address?
      addr_street: { id: 'addr_street', shape: 'square', formId: 'ADDR', edgeKey: 'down' },
      // leaf targets (carry the type)
      tn_name: { id: 'tn_name', shape: 'rhombus', formId: 'TN1', edgeKey: 'self', name: mt('String') }, // ◇ required
      tn_bio: { id: 'tn_bio', shape: 'rhombus', color: BLACK, formId: 'TN2', edgeKey: 'self', name: mt('String') }, // ◆ optional
      tn_title: { id: 'tn_title', shape: 'rhombus', formId: 'TN3', edgeKey: 'self', name: mt('String') },
      tn_sum: { id: 'tn_sum', shape: 'rhombus', formId: 'TN4', edgeKey: 'self', name: mt('String') },
      tn_street: { id: 'tn_street', shape: 'rhombus', formId: 'TN5', edgeKey: 'self', name: mt('String') },
    },
    lines: [
      { id: 'l_name', source: 'u_name', targets: ['tn_name'], name: mt('name') },
      { id: 'l_bio', source: 'u_bio', targets: ['tn_bio'], name: mt('bio') },
      { id: 'l_title', source: 'p_title', targets: ['tn_title'], name: mt('title') },
      { id: 'l_sum', source: 'a_sum', targets: ['tn_sum'], name: mt('summary') },
      { id: 'l_author', source: 'p_rel', targets: ['u_rel'], name: mt('author') }, // Post.author → User
      { id: 'l_addr', source: 'u_addr', targets: ['addr_in'], name: mt('address') }, // User.address → Address circle
      { id: 'l_street', source: 'addr_street', targets: ['tn_street'], name: mt('street') },
      { id: 'l_kind', source: 'p_kind', targets: ['k_peak'], name: mt('kind') }, // Post → Kind.peak (discriminator)
      { id: 'l_article', source: 'a_inj', targets: ['k_base'], name: mt('article') }, // Article ↪ Kind.base
    ],
  }
  const out = diagramToPrisma(d)

  it('scalars: type from the target, cardinality from its glyph', () => {
    expect(out).toMatch(/model User \{[\s\S]*id ObjectId @id @map\("_id"\)/)
    expect(out).toContain('name String') // ◇ required
    expect(out).toContain('bio String?') // ◆ optional
  })

  it('relation: owning side only — FK + @relation, no mirror, no @unique when reverse is many', () => {
    expect(out).toContain('authorId ObjectId')
    expect(out).toContain('author User @relation(fields: [authorId], references: [id])')
    expect(out).not.toContain('@unique')
  })

  it('coproduct triangle → @@discriminator(String) on the base + @@base on the variant', () => {
    expect(out).toMatch(/model Post \{[\s\S]*kind String[\s\S]*@@discriminator\(kind\)/)
    expect(out).toMatch(/model Article \{[\s\S]*@@base\(Post, "article"\)/)
    // Article is a variant → no separate id
    expect(out).not.toMatch(/model Article \{[\s\S]*@id/)
  })

  it('circle composite → a `type`, and the owning field references it', () => {
    expect(out).toMatch(/type Address \{[\s\S]*street String[\s\S]*\}/)
    expect(out).toContain('address Address?') // addr_in is ◆ → optional
  })

  it('always multi-line with a blank line between blocks', () => {
    expect(out).toContain('\n\nmodel ')
    expect(out).toContain('\n\ntype ')
  })

  it('@unique on a relation when the reverse (source) glyph is a single', () => {
    const d2: Diagram = JSON.parse(JSON.stringify(d))
    d2.points.p_rel.shape = 'rhombus' // reverse now at-most-one → one-to-one
    expect(diagramToPrisma(d2)).toContain('authorId ObjectId @unique')
  })
})
