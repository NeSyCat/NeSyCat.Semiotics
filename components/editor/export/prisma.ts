// NeSyCat Semiotics — diagram → Prisma Next contract.
//
// Pure string generation, NO DOM/React (like tikz.ts / html.ts), so it runs in
// the browser (the Export menu) AND in plain node (the nesycat-semiotics MCP's
// export_diagram tool) from the SAME function — one source of truth.
//
// Two targets share one `render()` body, differing ONLY in a tiny dialect:
//   - `diagramToPrisma`         (Document/MongoDB) — id = `ObjectId @id @map("_id")`
//   - `diagramToPrismaPostgres` (Postgres/relational) — id = `Uuid @id @default(uuid())`
// Everything else (value-object `type` blocks, relations, cardinality,
// `@@discriminator`/`@@base`, every other scalar) is byte-identical between
// the two — only the id line and the FK scalar type change.
//
// Encoding it reads:
//   - square form                 = a model
//   - triangle form               = a discriminated union (a coproduct): its
//        PEAK carries the discriminator field wire (base model → peak), its
//        BASE ('c') edge carries the variant injection wires (variant → base).
//        ⇒ `<field> String` + `@@discriminator(<field>)` on the base model, and
//        `@@base(Base, "<tag>")` on each variant (the injection wire's name).
//        Prisma Next requires the discriminator field to be String.
//   - circle form                 = a compound `type`; the wires fanning out of
//        its points are its fields, its name is the type name.
//   - empty form                  = a scalar type node (a leaf; its point label
//        is the scalar type, e.g. String).
//   - wire f: M → T                = a field `f` on M.
//        · target on a model  → a RELATION, declared on the owning side only:
//          FK `fId` + `@relation`, `@unique` iff the SOURCE glyph is a single
//          (one-to-one), no mirror field. Type = the target model.
//        · target on a composite → `f <TypeName>`; type = the target form.
//        · target on a leaf     → `f <label>`; type = the target point label.
//   - TARGET glyph → cardinality: rhombus+white `T`, rhombus+black `T?`,
//        square `T[]`. (Type is ALWAYS read from the target, never the source.)
//   - every non-variant model gets the dialect's id line (Mongo:
//        `id ObjectId @id @map("_id")`; Postgres: `id Uuid @id @default(uuid())`).
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

interface PrismaDialect { idField: string; fkType: string }
const MONGO_DIALECT: PrismaDialect = { idField: 'id ObjectId @id @map("_id")', fkType: 'ObjectId' }
const POSTGRES_DIALECT: PrismaDialect = { idField: 'id Uuid @id @default(uuid())', fkType: 'Uuid' }

function render(d: Diagram, dialect: PrismaDialect): string {
  const form = (id: string): Form | undefined => d.forms.find((f) => f.id === id)
  const pt = (id: string): Point | undefined => d.points[id]
  const outWires = (fid: string): Line[] => d.lines.filter((l) => !!l.source && pt(l.source)?.formId === fid)

  const isModel = (f: Form | undefined): f is Form & { shape: 'square' } => !!f && f.shape === 'square' && plain(f.name) !== ''
  // Shape vocabulary: square = model, circle = compound type, triangle =
  // discriminator, empty = scalar type node. So ONLY a circle is a composite.
  const isComposite = (f: Form | undefined): f is Form & { shape: 'circle' } => !!f && f.shape === 'circle'
  const modelForms = d.forms.filter(isModel)

  const single = (p: Point): boolean => p.shape === 'rhombus' // max 1
  const optional = (p: Point): boolean => !!p.color // filled/black = min 0
  const modifierOf = (p: Point): string => (!single(p) ? '[]' : optional(p) ? '?' : '')

  // ── Discriminated unions, from coproduct triangles ────────────────────
  const discOf: Record<string, { field: string; type: string }> = {} // base model → discriminator
  const baseOf: Record<string, { base: string; tag: string }> = {} // variant model → its @@base
  const discWireIds = new Set<string>() // wires that are part of a union (skipped as fields)
  for (const tri of d.forms.filter((f) => f.shape === 'triangle')) {
    const peakPts = new Set(tri.edges['peak'] ?? [])
    const basePts = new Set(tri.edges['c'] ?? [])
    const peakWire = d.lines.find((l) => l.targets.some((t) => peakPts.has(t)))
    if (!peakWire) continue
    const baseForm = form(pt(peakWire.source)?.formId ?? '')
    if (!isModel(baseForm)) continue
    const baseModel = plain(baseForm.name)
    const field = plain(peakWire.name) || 'kind'
    // Discriminator MUST be String in Prisma Next; use the peak's own scalar label if it is one.
    const peakLabel = plain(pt([...peakPts][0] ?? '')?.name)
    const type = peakLabel && SCALARS.has(peakLabel) ? peakLabel : 'String'
    discOf[baseModel] = { field, type }
    discWireIds.add(peakWire.id)
    for (const bw of d.lines.filter((l) => l.targets.some((t) => basePts.has(t)))) {
      const vForm = form(pt(bw.source)?.formId ?? '')
      if (!isModel(vForm)) continue
      baseOf[plain(vForm.name)] = { base: baseModel, tag: plain(bw.name) }
      discWireIds.add(bw.id)
    }
  }

  // ── Fields ────────────────────────────────────────────────────────────
  const typeBlocks: Record<string, string[]> = {}
  function fieldLines(l: Line): string[] {
    if (discWireIds.has(l.id)) return [] // part of a union — emitted as @@discriminator/@@base
    const tp = pt(l.targets[0])
    if (!tp) return []
    const tf = form(tp.formId)
    const fname = plain(l.name)
    // relation — the target sits on another model
    if (isModel(tf)) {
      const src = pt(l.source)
      const uniq = src && single(src) ? ' @unique' : ''
      const opt = optional(tp) ? '?' : ''
      return [
        `  ${fname}Id ${dialect.fkType}${uniq}`,
        `  ${fname} ${plain(tf.name)}${opt} @relation(fields: [${fname}Id], references: [id])`,
      ]
    }
    // embedded composite — the target form fans out into its own fields
    if (isComposite(tf)) {
      const typeName = plain(tf.name) || plain(tp.name)
      buildType(typeName, tf.id)
      return [`  ${fname} ${typeName}${modifierOf(tp)}`]
    }
    // scalar — the type is the target point's label
    return [`  ${fname} ${plain(tp.name)}${modifierOf(tp)}`]
  }
  function buildType(name: string, formId: string): void {
    if (typeBlocks[name]) return
    const lines: string[] = []
    typeBlocks[name] = lines // set first so a self-referential composite terminates
    for (const l of outWires(formId)) lines.push(...fieldLines(l))
  }

  // ── Models ────────────────────────────────────────────────────────────
  const blocks: string[] = []
  for (const mf of modelForms) {
    const name = plain(mf.name)
    const fields: string[] = []
    const attrs: string[] = []
    if (baseOf[name]) attrs.push(`  @@base(${baseOf[name].base}, "${baseOf[name].tag}")`)
    else fields.push(`  ${dialect.idField}`)
    for (const l of outWires(mf.id)) fields.push(...fieldLines(l))
    if (discOf[name]) {
      fields.push(`  ${discOf[name].field} ${discOf[name].type}`)
      attrs.push(`  @@discriminator(${discOf[name].field})`)
    }
    blocks.push(`model ${name} {\n${[...fields, ...attrs].join('\n')}\n}`)
  }
  for (const [name, lines] of Object.entries(typeBlocks)) blocks.push(`type ${name} {\n${lines.join('\n')}\n}`)

  return `// use prisma-next\n// Generated from a NeSyCat Semiotics diagram.\n\n${blocks.join('\n\n')}\n`
}

export function diagramToPrisma(d: Diagram): string { return render(d, MONGO_DIALECT) }
export function diagramToPrismaPostgres(d: Diagram): string { return render(d, POSTGRES_DIALECT) }
