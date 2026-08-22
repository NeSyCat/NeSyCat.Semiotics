import { describe, expect, it } from 'vitest'
import { diagramToPrisma } from '../../components/editor/export/prisma'
import type { Diagram } from '../../components/editor/domain/types'

// Helper: a filled (black) point = min 0; rhombus = max 1 (single), square = max ∞ (list).
const mt = (s: string) => `\\mathtt{${s}}`

describe('diagramToPrisma', () => {
  // User.name:String (white ◇ → required), User.bio:String? (black ◆ → optional),
  // User.author→Post relation (target white ◇ → single; source ■ square → many, no @unique),
  // Post discriminated into Article/Tutorial via a `kind` point + injections.
  const d: Diagram = {
    schemaVersion: 1,
    forms: [
      { id: 'U', shape: 'square', name: mt('User'), position: { x: 0, y: 0 }, edges: { left: ['u_name', 'u_bio'], right: ['u_rel'] } },
      { id: 'TN1', shape: 'empty', position: { x: -300, y: -50 }, edges: { self: ['tn1'] } },
      { id: 'TN2', shape: 'empty', position: { x: -300, y: 50 }, edges: { self: ['tn2'] } },
      { id: 'P', shape: 'square', name: mt('Post'), position: { x: 500, y: 0 }, edges: { left: ['p_rel'], bottom: ['p_kind'] } },
      { id: 'A', shape: 'square', name: mt('Article'), position: { x: 400, y: 400 }, edges: { top: ['a_inj'] } },
    ],
    points: {
      u_name: { id: 'u_name', shape: 'square', formId: 'U', edgeKey: 'left', name: mt('String') },
      tn1: { id: 'tn1', shape: 'rhombus', formId: 'TN1', edgeKey: 'self', name: mt('String') }, // white ◇ → required
      u_bio: { id: 'u_bio', shape: 'square', formId: 'U', edgeKey: 'left', name: mt('String') },
      tn2: { id: 'tn2', shape: 'rhombus', color: [0, 0, 0], formId: 'TN2', edgeKey: 'self', name: mt('String') }, // black ◆ → optional
      u_rel: { id: 'u_rel', shape: 'rhombus', formId: 'U', edgeKey: 'right', name: mt('Post') }, // white ◇ → author is exactly one User
      p_rel: { id: 'p_rel', shape: 'square', color: [0, 0, 0], formId: 'P', edgeKey: 'left', name: mt('User') }, // ■ many reverse → one-to-many, no @unique
      p_kind: { id: 'p_kind', shape: 'rhombus', formId: 'P', edgeKey: 'bottom', name: mt('kind') }, // discriminator point
      a_inj: { id: 'a_inj', shape: 'rhombus', color: [0, 0, 0], formId: 'A', edgeKey: 'top', name: mt('Post') },
    },
    lines: [
      { id: 'l_name', source: 'u_name', targets: ['tn1'], name: mt('name') },
      { id: 'l_bio', source: 'u_bio', targets: ['tn2'], name: mt('bio') },
      { id: 'l_author', source: 'p_rel', targets: ['u_rel'], name: mt('author') }, // Post.author → User
      { id: 'l_article', source: 'a_inj', targets: ['p_kind'], name: mt('article') }, // Article ↪ Post.kind
    ],
  }
  const out = diagramToPrisma(d)

  it('emits models with an auto id and correct field cardinalities', () => {
    expect(out).toContain('model User {')
    expect(out).toMatch(/model User \{[\s\S]*id ObjectId @id @map\("_id"\)/)
    expect(out).toContain('name String') // white ◇ → required
    expect(out).toContain('bio String?') // black ◆ → optional
  })

  it('emits a relation on the owning side only, with a FK and no mirror field', () => {
    expect(out).toContain('authorId ObjectId')
    expect(out).toContain('author User @relation(fields: [authorId], references: [id])')
    expect(out).not.toContain('authorId ObjectId @unique') // reverse is a square (many) → no @unique
    // no back-relation field named after User's model on Post, and no `posts` mirror
    expect(out).not.toMatch(/\bposts\b/)
  })

  it('emits the discriminator as a String field + @@discriminator, and @@base on the variant', () => {
    expect(out).toMatch(/model Post \{[\s\S]*kind String[\s\S]*@@discriminator\(kind\)/)
    expect(out).toMatch(/model Article \{[\s\S]*@@base\(Post, "article"\)/)
  })

  it('is always multi-line: one field per line and a blank line between blocks', () => {
    expect(out).toContain('\n\nmodel ') // blank line separates model blocks
    // no two fields crammed on one line (no "String  " followed by another field token on the same line)
    for (const line of out.split('\n')) {
      const decls = line.trim().match(/@relation|@@|@id/g) // attributes can co-occur with a field, that's fine
      expect(line.split(/\s{2,}/).filter((t) => /^[a-z]\w* (String|Int|ObjectId)/.test(t.trim())).length, `no two field decls on one line: "${line}"`).toBeLessThanOrEqual(1)
    }
  })

  it('@unique appears when the reverse (source) glyph is a single (one-to-one)', () => {
    const d2: Diagram = JSON.parse(JSON.stringify(d))
    d2.points.p_rel.shape = 'rhombus' // reverse (Post side) now "at most one" → @unique
    expect(diagramToPrisma(d2)).toContain('authorId ObjectId @unique')
  })
})
