// NeSyCat Semiotics — diagram → Prisma Next contract.
//
// Pure string generation, NO DOM/React (like tikz.ts / html.ts), so it runs in
// the browser (the Export menu) AND in plain node (the nesycat-semiotics MCP's
// export_diagram tool) from the SAME function — one source of truth.
//
// It reads the diagram's "points are types, wires are names" encoding plus the
// min/max glyph multiplicities:
//   - square form            = a model
//   - empty hub (fans out)   = a composite `type`
//   - empty leaf type-node   = a scalar type (String, Int, …)
//   - wire f: M → T          = a field `f` on M of type T
//   - TARGET glyph            = the field's cardinality:
//        rhombus + white  → T      (Identity,  1..1)
//        rhombus + black  → T?     (Maybe,     0..1)
//        square  + *      → T[]    (PowerSet / NonEmptyPowerSet, *..∞)
//   - a wire onto another MODEL = a relation, declared on the OWNING side only
//        (FK `fId` + `@relation`); the FK is `@unique` iff the SOURCE glyph is a
//        single (diamond) — that turns one-to-many into one-to-one. No mirror
//        field is emitted (Prisma Next doesn't support it; query from this side).
//   - a variant model whose port injects into a discriminator point on a base
//        → `@@base(Base, "tag")` on the variant, `@@discriminator(kind)` + a
//        `kind String` field on the base. (Prisma Next requires the
//        discriminator to be String.)
//   - every non-variant model gets `id ObjectId @id @map("_id")`.
//
// Output is ALWAYS multi-line: one field / attribute per line, a blank line
// between every block. Never condensed.
import type { Diagram, Form, Point, Line } from '../domain/types'

const SCALARS = new Set([
  'String', 'Int', 'Float', 'Boolean', 'DateTime', 'ObjectId', 'Json', 'Bytes', 'BigInt', 'Decimal',
])

// Labels are authored as KaTeX (e.g. `\mathtt{User}`); strip the wrapper to the
// bare identifier for schema text. Unknown macros are dropped, braces removed.
function plain(s: string | undefined): string {
  if (!s) return ''
  const wrap =
    /\\(?:mathtt|texttt|mathrm|textrm|mathbf|textbf|mathit|textit|mathsf|textsf|text|operatorname)\s*\{((?:[^{}]|\{[^{}]*\})*)\}/g
  let t = s
  let prev: string
  do { prev = t; t = t.replace(wrap, '$1') } while (t !== prev)
  return t.replace(/\\[a-zA-Z]+/g, '').replace(/[{}$]/g, '').trim()
}

export function diagramToPrisma(d: Diagram): string {
  const form = (id: string): Form | undefined => d.forms.find((f) => f.id === id)
  const pt = (id: string): Point | undefined => d.points[id]
  const modelNameOfForm = (fid: string): string => plain(form(fid)?.name)
  const outWires = (fid: string): Line[] => d.lines.filter((l) => !!l.source && pt(l.source)?.formId === fid)

  const isModelForm = (f: Form): boolean => f.shape === 'square' && plain(f.name) !== ''
  const modelForms = d.forms.filter(isModelForm)
  const models = new Set(modelForms.map((f) => plain(f.name)))

  const single = (p: Point): boolean => p.shape === 'rhombus' // max 1
  const optional = (p: Point): boolean => !!p.color // filled/black = min 0
  const modifierOf = (p: Point): string => (!single(p) ? '[]' : optional(p) ? '?' : '')

  // A discriminator point: sits on a MODEL, is labelled with neither a scalar
  // nor a model name, and is the target of variant-injection wires.
  const discOf: Record<string, { field: string; variants: { model: string; tag: string }[] }> = {}
  const baseOf: Record<string, { base: string; tag: string }> = {}
  for (const l of d.lines) {
    const tp = pt(l.targets[0])
    if (!tp) continue
    const tf = form(tp.formId)
    const label = plain(tp.name)
    if (tf && isModelForm(tf) && !SCALARS.has(label) && !models.has(label)) {
      const base = plain(tf.name)
      const src = pt(l.source)
      const variant = src ? modelNameOfForm(src.formId) : ''
      const tag = plain(l.name)
      if (!variant) continue
      discOf[base] ??= { field: (label || 'kind').toLowerCase(), variants: [] }
      discOf[base].variants.push({ model: variant, tag })
      baseOf[variant] = { base, tag }
    }
  }

  const typeBlocks: Record<string, string[]> = {}
  function fieldLines(l: Line): string[] {
    const tp = pt(l.targets[0])
    if (!tp) return []
    const tf = form(tp.formId)
    const fname = plain(l.name)
    // The type label: prefer the target (the codomain type node), but fall back
    // to the SOURCE port's label — type nodes on empty forms are nameless by
    // default, while the port on the model always carries the type.
    const label = plain(tp.name) || plain(pt(l.source)?.name)
    // relation — the field's target sits on another model
    if (tf && isModelForm(tf)) {
      const src = pt(l.source)
      const uniq = src && single(src) ? ' @unique' : ''
      const opt = optional(tp) ? '?' : ''
      return [
        `  ${fname}Id ObjectId${uniq}`,
        `  ${fname} ${plain(tf.name)}${opt} @relation(fields: [${fname}Id], references: [id])`,
      ]
    }
    // embedded composite — the target is an empty hub that fans out into fields
    if (tf && tf.shape === 'empty' && outWires(tf.id).length > 0) {
      buildType(label, tf.id)
      return [`  ${fname} ${label}${modifierOf(tp)}`]
    }
    // scalar
    return [`  ${fname} ${label}${modifierOf(tp)}`]
  }
  function buildType(name: string, hubFormId: string): void {
    if (typeBlocks[name]) return
    const lines: string[] = []
    typeBlocks[name] = lines // set first so a self-referential composite terminates
    for (const l of outWires(hubFormId)) lines.push(...fieldLines(l))
  }

  const blocks: string[] = []
  for (const mf of modelForms) {
    const name = plain(mf.name)
    const fields: string[] = []
    const attrs: string[] = []
    if (baseOf[name]) attrs.push(`  @@base(${baseOf[name].base}, "${baseOf[name].tag}")`)
    else fields.push('  id ObjectId @id @map("_id")')
    for (const l of outWires(mf.id)) {
      const tp = pt(l.targets[0])
      const tf = tp && form(tp.formId)
      const label = tp ? plain(tp.name) : ''
      // a wire onto a discriminator point is a variant injection (→ @@base), not a field
      if (tf && isModelForm(tf) && !SCALARS.has(label) && !models.has(label)) continue
      fields.push(...fieldLines(l))
    }
    if (discOf[name]) {
      fields.push(`  ${discOf[name].field} String`)
      attrs.push(`  @@discriminator(${discOf[name].field})`)
    }
    blocks.push(`model ${name} {\n${[...fields, ...attrs].join('\n')}\n}`)
  }
  for (const [name, lines] of Object.entries(typeBlocks)) blocks.push(`type ${name} {\n${lines.join('\n')}\n}`)

  return `// use prisma-next\n// Generated from a NeSyCat Semiotics diagram.\n\n${blocks.join('\n\n')}\n`
}
