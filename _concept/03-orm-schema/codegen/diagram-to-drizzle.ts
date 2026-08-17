#!/usr/bin/env tsx
/**
 * diagram-to-drizzle — read a NeSyCat string-diagram (conforming to the schema
 * convention documented in _concept/03-orm-schema/codegen/README.md) and emit a Drizzle schema.ts.
 *
 * Usage: tsx _concept/03-orm-schema/codegen/diagram-to-drizzle.ts <input.json> <output.ts>
 *
 * The output is marked DO NOT EDIT. Regenerate from the diagram instead.
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { relative, resolve } from 'node:path'
import type {
  DiagramData,
  DiagramEmpty,
  DiagramLine,
  DiagramPoint,
  DiagramRectangle,
} from './types'

type ColumnKind =
  | { kind: 'pk'; name: 'id'; tsType: 'uuid' }
  | { kind: 'scalar'; name: string; tsType: 'text' | 'jsonb' | 'tstz' | 'bool' }
  | { kind: 'fk'; name: string; targetRectId: string; targetIsExternal: boolean; targetTable: string }

// A table with exactly one external FK and one internal (table-targeting) FK,
// plus a bool `is_owner` column, is a MEMBERSHIP TABLE (see README's
// "Membership pattern" section). `groupTableName` is the plural table name of
// the internal FK's target (used in helper fn names, e.g. my_member_organizations());
// `groupSingular` is that target's singular name (e.g. organization_has_no_members).
interface MembershipInfo {
  userFkColumn: string
  groupFkColumn: string
  groupTableName: string
  groupSingular: string
}

// A table that is neither a membership table nor a GROUP table itself, with
// EXACTLY ONE FK column whose target is a GROUP table, is a GROUP-SCOPED
// TABLE (see README's "Group-scoped pattern" section) — every member of the
// owning group gets full CRUD via one `<T>_member_all` policy. `fkColumn` is
// that FK's column name; `groupTableName` is its target's plural table name
// (used in the `my_member_<G>()` helper reference).
interface GroupScopedInfo {
  fkColumn: string
  groupTableName: string
}

interface Table {
  rectId: string
  totalName: string
  singularName: string  // snake_case singular (pre-pluralization) — used as a GROUP table's name in helper fns
  tableName: string     // snake_case plural
  exportName: string    // camelCase plural
  columns: ColumnKind[]
  ownerFkColumn?: string
  membership?: MembershipInfo
  groupScoped?: GroupScopedInfo
}

interface ExternalRect {
  rectId: string
  totalName: string
}

function die(msg: string): never {
  console.error(`codegen error: ${msg}`)
  process.exit(1)
}

function snake(s: string): string {
  return s
    .replace(/[()]/g, '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[\s-]+/g, '_')
    .toLowerCase()
}

function camel(snakeStr: string): string {
  return snakeStr.replace(/_([a-z0-9])/g, (_, c: string) => c.toUpperCase())
}

function pluralize(s: string): string {
  // good enough for our corpus (Diagram → diagrams, User → users, Category → categories)
  if (/[^aeiou]y$/.test(s)) return s.slice(0, -1) + 'ies'
  if (/(s|x|z|ch|sh)$/.test(s)) return s + 'es'
  return s + 's'
}

function isExternalName(totalName: string): boolean {
  // Convention: "User (auth.users)" or anything starting with "User" is the Supabase-owned auth table.
  return /^User\b/.test(totalName.trim())
}

/** Build a lookup key for a rectangle slot that a line's source/target can attach to. */
function slotKey(side: DiagramPoint['side'], slot: DiagramPoint['slot'], index: number | undefined): string {
  const parts = [side ?? '?']
  if (slot) parts.push(slot)
  parts.push(String(index ?? 0))
  return parts.join('.')
}

/** Enumerate every slot on a rectangle that *might* carry a column, returning [key, point]. */
function enumerateSlots(rect: DiagramRectangle): Array<[string, DiagramPoint]> {
  const out: Array<[string, DiagramPoint]> = []
  const p = rect.points

  p.left.center.forEach((pt, i) => out.push([slotKey('left', 'center', i), pt]))
  p.right.center.forEach((pt, i) => out.push([slotKey('right', 'center', i), pt]))
  if (p.left.up)   out.push([slotKey('left', 'up', 0), p.left.up])
  if (p.left.down) out.push([slotKey('left', 'down', 0), p.left.down])
  if (p.right.up)   out.push([slotKey('right', 'up', 0), p.right.up])
  if (p.right.down) out.push([slotKey('right', 'down', 0), p.right.down])
  p.up.forEach((pt, i)   => out.push([slotKey('up', undefined, i), pt]))
  p.down.forEach((pt, i) => out.push([slotKey('down', undefined, i), pt]))
  if (p.center.up)   out.push([slotKey('center', 'up', 0), p.center.up])
  if (p.center.down) out.push([slotKey('center', 'down', 0), p.center.down])
  return out
}

function mapScalarType(pointName: string, columnName: string): { tsType: 'text' | 'jsonb' | 'tstz' | 'bool'; fragment: string } {
  switch (pointName) {
    case 'text':
      return { tsType: 'text', fragment: `text('${columnName}').notNull()` }
    case 'jsonb':
      return { tsType: 'jsonb', fragment: `jsonb('${columnName}').notNull()` }
    case 'tstz': {
      const def = columnName === 'created_at' || columnName === 'updated_at' ? '.defaultNow()' : ''
      return { tsType: 'tstz', fragment: `timestamp('${columnName}', { withTimezone: true }).notNull()${def}` }
    }
    case 'bool':
      return { tsType: 'bool', fragment: `boolean('${columnName}').notNull().default(false)` }
    default:
      return die(`unsupported scalar point type "${pointName}" on column "${columnName}"`)
  }
}

function main(): void {
  const [, , inPath, outPath] = process.argv
  if (!inPath || !outPath) die('usage: tsx _concept/03-orm-schema/codegen/diagram-to-drizzle.ts <input.json> <output.ts>')

  const absIn = resolve(process.cwd(), inPath)
  const absOut = resolve(process.cwd(), outPath)
  const raw = JSON.parse(readFileSync(absIn, 'utf8')) as DiagramData

  // Index empties + rectangles by id, and lines by source slot key (rectId → slotKey → line).
  const emptyById = new Map<string, DiagramEmpty>(raw.empties.map((e) => [e.id, e]))
  const rectById = new Map<string, DiagramRectangle>(raw.rectangles.map((r) => [r.id, r]))

  const lineBySource = new Map<string, DiagramLine>()
  for (const line of raw.lines) {
    const { source } = line.points
    if (!source.node) die(`line "${line.id}" has no source.node`)
    const key = `${source.node}|${slotKey(source.side, source.slot, source.index)}`
    if (lineBySource.has(key)) die(`duplicate line source at ${key} (lines "${line.id}" and "${lineBySource.get(key)!.id}")`)
    lineBySource.set(key, line)
  }

  // Classify rectangles: external (User*) vs table.
  const externals: ExternalRect[] = []
  const tableRects: DiagramRectangle[] = []
  for (const rect of raw.rectangles) {
    const name = rect.points.total?.name
    if (!name) die(`rectangle "${rect.id}" has no total.name`)
    if (isExternalName(name)) externals.push({ rectId: rect.id, totalName: name })
    else tableRects.push(rect)
  }

  const externalById = new Map<string, ExternalRect>(externals.map((e) => [e.rectId, e]))

  // Build each table.
  const tables: Table[] = tableRects.map((rect) => {
    const totalName = rect.points.total.name
    const singular = snake(totalName)
    const tableName = pluralize(singular)
    const exportName = camel(tableName)

    // Primary key: center.center must be uuid.
    const pk = rect.points.center?.center
    if (!pk) die(`table rectangle "${rect.id}" (${totalName}) has no center.center PK marker`)
    if (pk.name !== 'uuid') die(`table "${totalName}" PK must be uuid (found "${pk.name}")`)

    const columns: ColumnKind[] = [{ kind: 'pk', name: 'id', tsType: 'uuid' }]
    const seenNames = new Set<string>(['id'])
    let ownerFk: string | undefined

    for (const [key, point] of enumerateSlots(rect)) {
      const lineKey = `${rect.id}|${key}`
      const line = lineBySource.get(lineKey)
      if (!line) die(`slot ${lineKey} on table "${totalName}" has no outgoing line`)
      const target = line.points.targets[0]
      if (!target) die(`line "${line.id}" has no targets`)
      if (!target.node) die(`line "${line.id}" has no target.node`)

      if (emptyById.has(target.node)) {
        // Scalar column
        const underscore = line.id.indexOf('_')
        const colName = snake(underscore >= 0 ? line.id.slice(underscore + 1) : line.id)
        if (seenNames.has(colName)) die(`duplicate column "${colName}" on table "${totalName}"`)
        seenNames.add(colName)
        const { tsType } = mapScalarType(point.name, colName)
        columns.push({ kind: 'scalar', name: colName, tsType })
      } else if (rectById.has(target.node) || externalById.has(target.node)) {
        // FK column — target must be center.center of another rectangle
        if (target.side !== 'center' || target.slot !== 'center') {
          die(`line "${line.id}" targets rectangle "${target.node}" at ${slotKey(target.side, target.slot, target.index)} — FK lines must target center.center`)
        }
        if (point.name !== 'uuid') die(`line "${line.id}" source is "${point.name}" but FK must be uuid`)
        const colName = snake(line.id)
        if (seenNames.has(colName)) die(`duplicate column "${colName}" on table "${totalName}"`)
        seenNames.add(colName)
        const targetRect = rectById.get(target.node)
        const external = externalById.get(target.node)
        const targetTotalName = targetRect?.points.total.name ?? external?.totalName ?? target.node
        const targetTable = pluralize(snake(targetTotalName))
        const isExternal = Boolean(external)
        columns.push({ kind: 'fk', name: colName, targetRectId: target.node, targetIsExternal: isExternal, targetTable })

        if (external && isExternalName(external.totalName)) {
          if (ownerFk) die(`table "${totalName}" has multiple owner FKs (${ownerFk} and ${colName})`)
          ownerFk = colName
        }
      } else {
        die(`line "${line.id}" targets unknown node "${target.node}"`)
      }
    }

    return { rectId: rect.id, totalName, singularName: singular, tableName, exportName, columns, ownerFkColumn: ownerFk }
  })

  // Classify membership tables (structural, generic — see README's "Membership
  // pattern"): exactly one external FK + one internal (table-targeting) FK, plus
  // a bool `is_owner` column. Membership tables are exempt from the owner
  // template (their external FK must not emit *_own policies); the internal
  // FK's target becomes a GROUP table, which gets its own policy set.
  const groupRectIds = new Set<string>()
  for (const t of tables) {
    const fkCols = t.columns.filter((c): c is Extract<ColumnKind, { kind: 'fk' }> => c.kind === 'fk')
    const externalFks = fkCols.filter((c) => c.targetIsExternal)
    const internalFks = fkCols.filter((c) => !c.targetIsExternal)
    if (fkCols.length !== 2 || externalFks.length !== 1 || internalFks.length !== 1) continue

    const isOwnerCol = t.columns.find(
      (c): c is Extract<ColumnKind, { kind: 'scalar' }> => c.kind === 'scalar' && c.tsType === 'bool' && c.name === 'is_owner',
    )
    if (!isOwnerCol) {
      die(
        `table "${t.totalName}" has one external FK (${externalFks[0].name}) and one internal FK (${internalFks[0].name}) — ` +
          `looks like a membership table but has no bool column named "is_owner"`,
      )
    }

    const groupRect = tables.find((g) => g.rectId === internalFks[0].targetRectId)
    if (!groupRect) die(`membership table "${t.totalName}" — internal FK "${internalFks[0].name}" does not target a table rectangle`)

    t.ownerFkColumn = undefined // suppress the single-owner-FK template for this table
    t.membership = {
      userFkColumn: externalFks[0].name,
      groupFkColumn: internalFks[0].name,
      groupTableName: internalFks[0].targetTable,
      groupSingular: groupRect.singularName,
    }
    groupRectIds.add(groupRect.rectId)
  }

  // Classify group-scoped tables (structural, generic — see README's
  // "Group-scoped pattern"): a table that is neither a membership table nor a
  // GROUP table itself, with EXACTLY ONE FK column whose target is a GROUP
  // table (groupRectIds, populated above), gets a single `<T>_member_all`
  // policy — every member of the owning group has full CRUD on rows scoped to
  // it. A non-membership table with an FK to a group table that doesn't match
  // this shape (i.e. more than one FK column) is ambiguous intent — die()
  // rather than guess, same as the rest of this generator's error posture.
  for (const t of tables) {
    if (t.membership || groupRectIds.has(t.rectId)) continue
    const fkCols = t.columns.filter((c): c is Extract<ColumnKind, { kind: 'fk' }> => c.kind === 'fk')
    const toGroup = fkCols.filter((c) => !c.targetIsExternal && groupRectIds.has(c.targetRectId))
    if (toGroup.length === 0) continue
    if (fkCols.length !== 1) {
      die(
        `table "${t.totalName}" has an FK to group table "${toGroup[0].targetTable}" but doesn't match the ` +
          `group-scoped-table pattern (expected exactly one FK column, found ${fkCols.length})`,
      )
    }
    t.groupScoped = { fkColumn: toGroup[0].name, groupTableName: toGroup[0].targetTable }
  }

  // Emit TS
  const parts: string[] = []
  const relIn = relative(process.cwd(), absIn).replace(/\\/g, '/')
  parts.push(
    `// DO NOT EDIT — generated by _concept/03-orm-schema/codegen/diagram-to-drizzle.ts from ${relIn}.`,
    `// Edit the diagram, then run: npm run db:diagram`,
    ``,
    `import { pgTable, uuid, text, jsonb, timestamp, boolean, pgPolicy } from 'drizzle-orm/pg-core'`,
    `import { sql } from 'drizzle-orm'`,
    `import { authenticatedRole, authUid } from 'drizzle-orm/supabase'`,
    ``,
  )

  const imports = new Set<string>(['uuid'])
  for (const t of tables) for (const c of t.columns) {
    if (c.kind === 'scalar') imports.add(c.tsType === 'tstz' ? 'timestamp' : c.tsType === 'bool' ? 'boolean' : c.tsType)
  }

  for (const table of tables) {
    parts.push(`export const ${table.exportName} = pgTable(`)
    parts.push(`  '${table.tableName}',`)
    parts.push(`  {`)
    for (const col of table.columns) {
      if (col.kind === 'pk') {
        parts.push(`    id: uuid('id').primaryKey().defaultRandom(),`)
      } else if (col.kind === 'fk') {
        // Internal (table→table) FKs get a real .references() constraint —
        // lazy arrow so forward references (target declared later in the
        // file) are fine. External (User*/auth.users) FKs stay a plain uuid
        // column: an enforcing FK there would block deleting a login
        // (right-to-erasure doctrine — see SCHEMA.md).
        if (col.targetIsExternal) {
          parts.push(`    ${camel(col.name)}: uuid('${col.name}').notNull(),`)
        } else {
          const targetExport = camel(col.targetTable)
          parts.push(`    ${camel(col.name)}: uuid('${col.name}').notNull().references(() => ${targetExport}.id),`)
        }
      } else {
        const { fragment } = mapScalarType(
          col.tsType === 'tstz' ? 'tstz' : col.tsType,
          col.name,
        )
        parts.push(`    ${camel(col.name)}: ${fragment},`)
      }
    }
    parts.push(`  },`)

    // Build the policy set: owner template XOR membership template (mutually
    // exclusive — membership tables are exempt from the owner template), plus
    // the group template appended for any table that is a membership's group
    // target. All three write into one `policyLines` list because Drizzle's
    // pgTable() takes a single extraConfig callback per table.
    const policyLines: string[] = []

    if (table.membership) {
      const m = table.membership
      const u = `t.${camel(m.userFkColumn)}`
      const g = `t.${camel(m.groupFkColumn)}`
      const isOwner = `t.${camel('is_owner')}`
      const G = m.groupTableName
      const S = m.groupSingular
      policyLines.push(`pgPolicy('${table.tableName}_select_self', { for: 'select', to: authenticatedRole, using: sql\`\${${u}} = \${authUid}\` }),`)
      policyLines.push(`pgPolicy('${table.tableName}_select_member', { for: 'select', to: authenticatedRole, using: sql\`\${${g}} in (select public.my_member_${G}())\` }),`)
      policyLines.push(`pgPolicy('${table.tableName}_insert_owner', { for: 'insert', to: authenticatedRole, withCheck: sql\`\${${g}} in (select public.my_owner_${G}())\` }),`)
      policyLines.push(
        `pgPolicy('${table.tableName}_insert_bootstrap', { for: 'insert', to: authenticatedRole, withCheck: sql\`\${${u}} = \${authUid} and \${${isOwner}} = true and public.${S}_has_no_members(\${${g}})\` }),`,
      )
      policyLines.push(`pgPolicy('${table.tableName}_update_owner', { for: 'update', to: authenticatedRole, using: sql\`\${${g}} in (select public.my_owner_${G}())\`, withCheck: sql\`\${${g}} in (select public.my_owner_${G}())\` }),`)
      policyLines.push(`pgPolicy('${table.tableName}_delete_owner', { for: 'delete', to: authenticatedRole, using: sql\`\${${g}} in (select public.my_owner_${G}())\` }),`)
    } else if (table.ownerFkColumn) {
      const owner = `t.${camel(table.ownerFkColumn)}`
      policyLines.push(`pgPolicy('${table.tableName}_select_own', { for: 'select', to: authenticatedRole, using: sql\`\${${owner}} = \${authUid}\` }),`)
      policyLines.push(`pgPolicy('${table.tableName}_insert_own', { for: 'insert', to: authenticatedRole, withCheck: sql\`\${${owner}} = \${authUid}\` }),`)
      policyLines.push(`pgPolicy('${table.tableName}_update_own', { for: 'update', to: authenticatedRole, using: sql\`\${${owner}} = \${authUid}\`, withCheck: sql\`\${${owner}} = \${authUid}\` }),`)
      policyLines.push(`pgPolicy('${table.tableName}_delete_own', { for: 'delete', to: authenticatedRole, using: sql\`\${${owner}} = \${authUid}\` }),`)
    } else if (table.groupScoped) {
      const gs = table.groupScoped
      const fk = `t.${camel(gs.fkColumn)}`
      const G = gs.groupTableName
      policyLines.push(
        `pgPolicy('${table.tableName}_member_all', { for: 'all', to: authenticatedRole, using: sql\`\${${fk}} in (select public.my_member_${G}())\`, withCheck: sql\`\${${fk}} in (select public.my_member_${G}())\` }),`,
      )
    }

    if (groupRectIds.has(table.rectId)) {
      const G = table.tableName
      const id = `t.id`
      policyLines.push(`pgPolicy('${G}_select_member', { for: 'select', to: authenticatedRole, using: sql\`\${${id}} in (select public.my_member_${G}())\` }),`)
      policyLines.push(`pgPolicy('${G}_insert_auth', { for: 'insert', to: authenticatedRole, withCheck: sql\`true\` }),`)
      policyLines.push(`pgPolicy('${G}_update_owner', { for: 'update', to: authenticatedRole, using: sql\`\${${id}} in (select public.my_owner_${G}())\`, withCheck: sql\`\${${id}} in (select public.my_owner_${G}())\` }),`)
      policyLines.push(`pgPolicy('${G}_delete_owner', { for: 'delete', to: authenticatedRole, using: sql\`\${${id}} in (select public.my_owner_${G}())\` }),`)
    }

    if (policyLines.length > 0) {
      parts.push(`  (t) => [`)
      for (const line of policyLines) parts.push(`    ${line}`)
      parts.push(`  ],`)
    }
    parts.push(`)`)
    parts.push(``)
    parts.push(`export type ${capitalize(camel(snake(table.totalName)))} = typeof ${table.exportName}.$inferSelect`)
    parts.push(`export type New${capitalize(camel(snake(table.totalName)))} = typeof ${table.exportName}.$inferInsert`)
    parts.push(``)
  }

  writeFileSync(absOut, parts.join('\n'))
  console.log(`wrote ${relative(process.cwd(), absOut)} (${tables.length} table${tables.length === 1 ? '' : 's'})`)
}

function capitalize(s: string): string { return s.charAt(0).toUpperCase() + s.slice(1) }

main()
