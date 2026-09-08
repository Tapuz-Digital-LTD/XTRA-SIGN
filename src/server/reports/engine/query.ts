import { sql, type SQL } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { attentionForAgreements, topReason } from '@/server/attention/attention'
import { getDb } from '@/server/db'
import { ENTITIES, fieldMeta, formField, pgArray, type EntityDef, type FieldDef } from './registry'
import { EXPORT_CAP, MAX_PAGE_SIZE, OPERATORS, REPORT_ENTITIES, type Clause, type Condition, type ConditionValue, type FieldMeta, type ReportDefinition, type ReportEntity, type ReportRow, type RunRequest, type RunResult } from './types'

/**
 * Runs a report definition: the registry says what each field is, this file
 * turns clauses into WHERE, columns into SELECT, a sort into ORDER BY, and
 * pages on the server. Everything from the browser is a bound parameter.
 */

export class ReportError extends Error {}

const UUID_RE = /^[0-9a-f-]{36}$/i
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function isReportEntity(value: unknown): value is ReportEntity {
  return typeof value === 'string' && (REPORT_ENTITIES as readonly string[]).includes(value)
}

/** The fields of an entity for this organisation — the registry plus the campaigns' custom form fields. */
export async function fieldsFor(session: StaffSession, entity: ReportEntity): Promise<FieldDef[]> {
  const base = ENTITIES[entity].fields
  if (entity !== 'people') return base
  const rows = (await getDb().execute(sql`
    select x.id, x.label, string_agg(distinct g.name, ', ' order by g.name) as campaigns
    from groups g
    cross join lateral (
      select e->>'id' as id, e->>'label' as label
      from jsonb_array_elements(case when jsonb_typeof(g.landing_config->'fields') = 'array' then g.landing_config->'fields' else '[]'::jsonb end) e
      where (e->>'id') like 'custom_%' and (e->>'label') is not null
    ) x
    where g.organization_id = ${session.organizationId} and g.deleted_at is null
    group by x.id, x.label
    order by x.label
    limit 60`)).rows as { id: string; label: string; campaigns: string }[]
  return [...base, ...rows.map((r) => formField(r.id, r.label, `רק בקמפיינים: ${r.campaigns}`))]
}

function fieldOf(fields: FieldDef[], key: string): FieldDef {
  const found = fields.find((f) => f.key === key)
  if (!found) throw new ReportError(`שדה לא מוכר: ${key}`)
  return found
}

function asStrings(value: ConditionValue | undefined): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean).slice(0, 200)
  if (typeof value === 'string' && value) return [value]
  return []
}

function dateBoundary(value: unknown, endOfDay: boolean): SQL | null {
  if (typeof value !== 'string') return null
  const today = new Date()
  const isoOf = (d: Date) => d.toISOString().slice(0, 10)
  const iso = value === 'today' ? isoOf(today) : value === 'tomorrow' ? isoOf(new Date(today.getTime() + 86_400_000)) : value === 'yesterday' ? isoOf(new Date(today.getTime() - 86_400_000)) : ISO_DATE_RE.test(value) ? value : null
  if (!iso) return null
  // Day boundaries in Israel time, so "until the 7th" means the whole 7th.
  return endOfDay ? sql`(${iso}::date + 1)::timestamp at time zone 'Asia/Jerusalem'` : sql`${iso}::date::timestamp at time zone 'Asia/Jerusalem'`
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`)

/** One condition → one SQL predicate, or null when it says nothing (empty values). */
function compile(field: FieldDef, cond: Condition): SQL | null {
  const allowed = OPERATORS[field.type] as readonly string[]
  if (!allowed.includes(cond.op)) throw new ReportError(`הפעולה "${cond.op}" לא מתאימה לשדה "${field.label}".`)
  if (!field.filterable) throw new ReportError(`אי אפשר לסנן לפי "${field.label}".`)
  const e = field.expr
  if (cond.op === 'is_empty') return field.type === 'tags' || field.type === 'campaign' ? sql`coalesce(array_length(${e}, 1), 0) = 0` : sql`(${e} is null or ${e}::text = '')`
  if (cond.op === 'is_not_empty') return field.type === 'tags' || field.type === 'campaign' ? sql`coalesce(array_length(${e}, 1), 0) > 0` : sql`(${e} is not null and ${e}::text <> '')`

  switch (field.type) {
    case 'text': {
      const v = typeof cond.value === 'string' ? cond.value.trim().slice(0, 200) : ''
      if (!v) return null
      if (cond.op === 'contains') return sql`${e}::text ilike ${`%${escapeLike(v)}%`}`
      if (cond.op === 'not_contains') return sql`(${e} is null or ${e}::text not ilike ${`%${escapeLike(v)}%`})`
      if (cond.op === 'starts_with') return sql`${e}::text ilike ${`${escapeLike(v)}%`}`
      if (cond.op === 'equals') return sql`lower(${e}::text) = lower(${v})`
      return null
    }
    case 'number': {
      const n = typeof cond.value === 'number' ? cond.value : typeof cond.value === 'string' ? Number(cond.value) : NaN
      if (cond.op === 'between') {
        const r = (cond.value ?? {}) as { from?: string; to?: string }
        const from = r.from !== undefined && r.from !== '' ? Number(r.from) : null
        const to = r.to !== undefined && r.to !== '' ? Number(r.to) : null
        const parts: SQL[] = []
        if (from !== null && !Number.isNaN(from)) parts.push(sql`${e} >= ${from}`)
        if (to !== null && !Number.isNaN(to)) parts.push(sql`${e} <= ${to}`)
        return parts.length ? sql.join(parts, sql` and `) : null
      }
      if (Number.isNaN(n)) return null
      if (cond.op === 'equals') return sql`${e} = ${n}`
      if (cond.op === 'gt') return sql`${e} > ${n}`
      if (cond.op === 'lt') return sql`${e} < ${n}`
      return null
    }
    case 'date': {
      if (cond.op === 'between') {
        const r = (cond.value ?? {}) as { from?: string; to?: string }
        const from = dateBoundary(r.from, false)
        const to = dateBoundary(r.to, true)
        const parts: SQL[] = []
        if (from) parts.push(sql`${e} >= ${from}`)
        if (to) parts.push(sql`${e} < ${to}`)
        return parts.length ? sql.join(parts, sql` and `) : null
      }
      if (cond.op === 'before') {
        const b = dateBoundary(cond.value, false)
        return b ? sql`${e} < ${b}` : null
      }
      if (cond.op === 'after') {
        const b = dateBoundary(cond.value, true)
        return b ? sql`${e} >= ${b}` : null
      }
      if (cond.op === 'last_days') {
        const days = typeof cond.value === 'object' && cond.value && 'days' in cond.value ? Number(cond.value.days) : Number(cond.value)
        if (!Number.isFinite(days) || days <= 0 || days > 3660) return null
        return sql`${e} >= now() - (${Math.floor(days)} * interval '1 day')`
      }
      return null
    }
    case 'enum':
    case 'user': {
      const values = asStrings(cond.value)
      if (values.length === 0) return null
      if (cond.op === 'is') return sql`${e}::text = ${values[0]}`
      if (cond.op === 'is_not') return sql`(${e} is null or ${e}::text <> ${values[0]})`
      if (cond.op === 'one_of') return sql`${e}::text = any(${pgArray(values)}::text[])`
      if (cond.op === 'not_one_of') return sql`(${e} is null or not (${e}::text = any(${pgArray(values)}::text[])))`
      return null
    }
    case 'boolean': {
      const v = cond.value === true || cond.value === 'true'
      return v ? sql`${e}` : sql`not ${e}`
    }
    case 'tags':
    case 'campaign': {
      const values = asStrings(cond.value).filter((v) => UUID_RE.test(v))
      if (values.length === 0 || !field.relFilter) return null
      return field.relFilter(cond.op, values)
    }
    default:
      return null
  }
}

/** The campaign ids a report is scoped to, from its own conditions. */
function campaignScope(def: EntityDef, clauses: Clause[]): string[] | null {
  if (!def.campaignField) return null
  const ids: string[] = []
  for (const clause of clauses) {
    if (clause.any.length !== 1) continue
    const c = clause.any[0]
    if (c.field === def.campaignField && c.op === 'one_of') ids.push(...asStrings(c.value).filter((v) => UUID_RE.test(v)))
  }
  return ids.length ? [...new Set(ids)] : null
}

function whereFor(def: EntityDef, fields: FieldDef[], session: StaffSession, clauses: Clause[]): SQL {
  const parts: SQL[] = [sql`(${def.where(session.organizationId)})`]
  for (const clause of clauses.slice(0, 40)) {
    const ors: SQL[] = []
    for (const cond of clause.any.slice(0, 20)) {
      const p = compile(fieldOf(fields, cond.field), cond)
      if (p) ors.push(sql`(${p})`)
    }
    if (ors.length) parts.push(sql`(${sql.join(ors, sql` or `)})`)
  }
  return sql.join(parts, sql` and `)
}

function selectedColumns(fields: FieldDef[], keys: string[]): FieldDef[] {
  const chosen = keys.length ? keys.map((k) => fieldOf(fields, k)) : fields.filter((f) => f.defaultVisible)
  return [...new Map(chosen.map((f) => [f.key, f])).values()].slice(0, 60)
}

function renderCell(field: FieldDef, raw: unknown): ReportRow['cells'][string] {
  if (raw === null || raw === undefined) return null
  if (raw instanceof Date) return raw.toISOString()
  if (Array.isArray(raw)) return raw.map(String)
  if (typeof raw === 'boolean') return raw
  if (typeof raw === 'number') return raw
  const text = String(raw)
  if (field.type === 'date') {
    const d = new Date(text)
    return Number.isNaN(d.getTime()) ? text : d.toISOString()
  }
  return text
}

/** One page of a report. */
export async function runReport(session: StaffSession, request: RunRequest): Promise<RunResult> {
  const { def, fields, columns, where, scope } = await prepare(session, request)
  const page = Math.max(1, Math.floor(request.page ?? 1))
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(request.pageSize ?? 25)))
  const total = await count(def, where, scope)
  const rows = await fetchRows(session, def, fields, columns, where, scope, request.sort, pageSize, (page - 1) * pageSize)
  return { rows, total, page, pageSize, columns: columns.map(fieldMeta) }
}

/** Every matching row, in order, for the file — up to the cap, a thousand at a time. */
export async function* iterateReport(session: StaffSession, definition: ReportDefinition & { ids?: string[] }): AsyncGenerator<{ rows: ReportRow[]; columns: FieldDef[] }> {
  const { def, fields, columns, where, scope } = await prepare(session, definition)
  const onlyIds = definition.ids?.filter((id) => UUID_RE.test(id)).slice(0, 5000)
  const scopedWhere = onlyIds?.length ? sql`${where} and ${def.id}::text = any(${pgArray(onlyIds)}::text[])` : where
  let offset = 0
  while (offset < EXPORT_CAP) {
    const rows = await fetchRows(session, def, fields, columns, scopedWhere, scope, definition.sort, 1000, offset)
    if (rows.length === 0) return
    yield { rows, columns }
    if (rows.length < 1000) return
    offset += 1000
  }
}

async function prepare(session: StaffSession, definition: ReportDefinition) {
  if (!isReportEntity(definition.entity)) throw new ReportError('בחרו מה להציג.')
  const def = ENTITIES[definition.entity]
  const fields = await fieldsFor(session, definition.entity)
  const clauses = Array.isArray(definition.clauses) ? definition.clauses.filter((c) => c && Array.isArray(c.any)) : []
  const scope = campaignScope(def, clauses)
  const where = whereFor(def, fields, session, clauses)
  const columns = selectedColumns(fields, Array.isArray(definition.columns) ? definition.columns.filter((c): c is string => typeof c === 'string') : [])
  return { def, fields, columns, where, scope }
}

async function count(def: EntityDef, where: SQL, scope: string[] | null): Promise<number> {
  const result = await getDb().execute(sql`select count(*)::int as n from ${def.from(scope)} where ${where}`)
  return Number((result.rows[0] as { n: number } | undefined)?.n ?? 0)
}

async function fetchRows(session: StaffSession, def: EntityDef, fields: FieldDef[], columns: FieldDef[], where: SQL, scope: string[] | null, sort: ReportDefinition['sort'], limit: number, offset: number): Promise<ReportRow[]> {
  const selects: SQL[] = [sql`${def.id}::text as "__id"`]
  for (const [name, expr] of Object.entries(def.links)) if (expr) selects.push(sql`${expr}::text as ${sql.raw(`"__${name}"`)}`)
  columns.forEach((c, i) => selects.push(sql`${c.expr} as ${sql.raw(`"c${i}"`)}`))

  let order = sql`${def.id}`
  if (sort && typeof sort.field === 'string') {
    const sf = fieldOf(fields, sort.field)
    if (!sf.sortable) throw new ReportError(`אי אפשר למיין לפי "${sf.label}".`)
    order = sql`${sf.expr} ${sort.dir === 'asc' ? sql`asc nulls last` : sql`desc nulls last`}, ${def.id}`
  }

  const result = await getDb().execute(sql`select ${sql.join(selects, sql`, `)} from ${def.from(scope)} where ${where} order by ${order} limit ${limit} offset ${offset}`)
  const raw = result.rows as Record<string, unknown>[]
  const rows: ReportRow[] = raw.map((r) => {
    const cells: ReportRow['cells'] = {}
    columns.forEach((c, i) => {
      cells[c.key] = renderCell(c, r[`c${i}`])
    })
    const links: ReportRow['links'] = {}
    for (const name of ['company', 'agreement', 'lead', 'group', 'task'] as const) {
      const v = r[`__${name}`]
      if (typeof v === 'string' && v) links[name] = v
    }
    return { id: String(r.__id), cells, links }
  })

  // People are shown by name, never by id: one lookup per page for every user-typed column.
  const userColumns = columns.filter((c) => c.type === 'user')
  if (userColumns.length) {
    const ids = [...new Set(rows.flatMap((r) => userColumns.map((c) => r.cells[c.key])).filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)))]
    if (ids.length) {
      const users = (await getDb().execute(sql`select id::text as id, coalesce(nullif(name, ''), email) as name from users where id::text = any(${pgArray(ids)}::text[])`)).rows as { id: string; name: string }[]
      const byId = new Map(users.map((u) => [u.id, u.name]))
      for (const row of rows) for (const c of userColumns) if (typeof row.cells[c.key] === 'string') row.cells[c.key] = byId.get(row.cells[c.key] as string) ?? row.cells[c.key]
    }
  }

  // The reason behind "דורש טיפול" comes from the attention module (one batch per page), never a second rule set.
  if (columns.some((c) => c.key === 'attention_reason')) {
    const ids = rows.map((r) => r.links.agreement).filter((x): x is string => Boolean(x))
    const reasons = ids.length ? await attentionForAgreements(session.organizationId, ids) : new Map()
    for (const row of rows) {
      const top = row.links.agreement ? topReason(reasons.get(row.links.agreement)) : null
      row.cells.attention_reason = top ? top.title : null
    }
  }
  return rows
}

/** Labels for enum cells, for the table and the file. */
export function labelFor(field: FieldMeta & { labels?: Record<string, string> }, value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return value.map(String).join(', ')
  if (typeof value === 'boolean') return value ? 'כן' : 'לא'
  const text = String(value)
  return field.labels?.[text] ?? field.options?.find((o) => o.value === text)?.label ?? text
}
