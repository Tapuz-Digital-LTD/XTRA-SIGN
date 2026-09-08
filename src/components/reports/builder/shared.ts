import type { Condition, FieldMeta, FieldType, Operator, ReportDefinition, ReportEntity, ReportRow, RunRequest, RunResult } from '@/server/reports/engine/types'

/**
 * What every builder piece shares: the fetch that speaks the API's error
 * shape, the definition's trip through the URL, and the shape a condition's
 * value takes for a field type and operator.
 */

export const ENTITIES: ReportEntity[] = ['suppliers', 'customers', 'people', 'agreements', 'tasks', 'sends']
export const PAGE_SIZES = [25, 50, 100] as const
/** Whole-filter selections are resolved page by page up to here — enough for a morning's work, not a data dump. */
export const SELECT_ALL_CAP = 5_000

export const btnPrimary = 'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-brand px-5 text-base font-semibold text-white transition hover:bg-[var(--color-accent-hover)] disabled:opacity-50'
export const btnSecondary = 'inline-flex min-h-11 items-center justify-center gap-1 rounded-xl border border-line bg-surface px-4 text-sm font-medium text-fg transition hover:border-brand disabled:opacity-50'
export const btnLink = 'inline-flex min-h-11 items-center px-1 text-sm text-brand underline-offset-4 hover:underline disabled:opacity-50'
export const fieldClass = 'min-h-11 w-full rounded-xl border border-line bg-surface px-3 text-sm text-fg outline-none focus:border-brand'

/** fetch that throws the backend's message (`{ error: { message } }`) instead of a status code. */
export async function api<T>(url: string, json?: unknown, method?: string): Promise<T> {
  let response: Response
  try {
    response = await fetch(url, json === undefined ? { method } : { method: method ?? 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(json) })
  } catch {
    throw new Error('אין חיבור לשרת. בדקו את החיבור לאינטרנט.')
  }
  const data = await response.json().catch(() => null)
  if (!response.ok) throw new Error(data?.error?.message ?? (response.status === 404 ? 'השירות עדיין לא זמין.' : `הפעולה נכשלה (${response.status}).`))
  return data as T
}

export const isEntity = (value: unknown): value is ReportEntity => typeof value === 'string' && (ENTITIES as string[]).includes(value)

/** The definition part of a request — what gets saved and exported. */
export function definitionOf(request: RunRequest): ReportDefinition {
  return { entity: request.entity, clauses: request.clauses, columns: request.columns, sort: request.sort ?? null }
}

export function emptyRequest(entity: ReportEntity): RunRequest {
  return { entity, clauses: [], columns: [], sort: null, page: 1, pageSize: 25 }
}

/** `?d=` — base64url of the JSON, so Hebrew and long lists travel in a link. */
export function encodeRequest(request: RunRequest): string {
  const bytes = new TextEncoder().encode(JSON.stringify(request))
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeRequest(raw: string | null | undefined): RunRequest | null {
  if (!raw) return null
  try {
    const binary = atob(raw.replace(/-/g, '+').replace(/_/g, '/'))
    const parsed = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))) as Partial<RunRequest>
    if (!isEntity(parsed.entity)) return null
    return {
      entity: parsed.entity,
      clauses: Array.isArray(parsed.clauses) ? parsed.clauses.filter((c) => c && Array.isArray(c.any)) : [],
      columns: Array.isArray(parsed.columns) ? parsed.columns.filter((c): c is string => typeof c === 'string') : [],
      sort: parsed.sort && typeof parsed.sort.field === 'string' ? { field: parsed.sort.field, dir: parsed.sort.dir === 'asc' ? 'asc' : 'desc' } : null,
      page: Number.isInteger(parsed.page) && parsed.page! > 0 ? parsed.page : 1,
      pageSize: (PAGE_SIZES as readonly number[]).includes(parsed.pageSize ?? 0) ? parsed.pageSize : 25,
    }
  } catch {
    return null
  }
}

export const defaultColumns = (fields: FieldMeta[]) => fields.filter((f) => f.defaultVisible).map((f) => f.key)

/** How a condition's value is entered: one of these controls. */
export type ValueShape = 'none' | 'text' | 'number' | 'numberRange' | 'date' | 'dateRange' | 'days' | 'one' | 'many' | 'bool' | 'campaigns' | 'tags' | 'user' | 'users'

export function shapeOf(type: FieldType, op: Operator): ValueShape {
  if (op === 'is_empty' || op === 'is_not_empty') return 'none'
  switch (type) {
    case 'text':
      return 'text'
    case 'number':
      return op === 'between' ? 'numberRange' : 'number'
    case 'date':
      return op === 'between' ? 'dateRange' : op === 'last_days' ? 'days' : 'date'
    case 'enum':
      return op === 'one_of' || op === 'not_one_of' ? 'many' : 'one'
    case 'tags':
      return 'tags'
    case 'campaign':
      return 'campaigns'
    case 'user':
      return op === 'one_of' ? 'users' : 'user'
    case 'boolean':
      return 'bool'
  }
}

/** A condition that says something: has a value where the operator needs one. */
export function conditionComplete(fields: FieldMeta[], condition: Condition): boolean {
  const field = fields.find((f) => f.key === condition.field)
  if (!field) return false
  const shape = shapeOf(field.type, condition.op)
  const v = condition.value
  switch (shape) {
    case 'none':
      return true
    case 'bool':
      return typeof v === 'boolean'
    case 'many':
    case 'campaigns':
    case 'tags':
    case 'users':
      return Array.isArray(v) && v.length > 0
    case 'numberRange':
    case 'dateRange':
      return typeof v === 'object' && v !== null && !Array.isArray(v) && ('from' in v || 'to' in v) && Boolean(v.from || v.to)
    case 'days':
      return typeof v === 'object' && v !== null && 'days' in v && v.days > 0
    default:
      return v !== undefined && v !== null && v !== ''
  }
}

/** The id an action needs from a row, by what the row is. */
export const leadIdOf = (entity: ReportEntity, row: ReportRow) => row.links.lead ?? (entity === 'people' ? row.id : undefined)
export const companyIdOf = (entity: ReportEntity, row: ReportRow) => row.links.company ?? (entity === 'suppliers' || entity === 'customers' ? row.id : undefined)
export const agreementIdOf = (entity: ReportEntity, row: ReportRow) => row.links.agreement ?? (entity === 'agreements' ? row.id : undefined)
export const taskIdOf = (entity: ReportEntity, row: ReportRow) => row.links.task ?? (entity === 'tasks' ? row.id : undefined)

/** Every matching row, page by page, up to the cap. Says whether the cap cut it short. */
export async function fetchAllRows(request: RunRequest, onProgress?: (n: number) => void): Promise<{ rows: ReportRow[]; capped: boolean; total: number }> {
  const rows: ReportRow[] = []
  let total = 0
  for (let page = 1; rows.length < SELECT_ALL_CAP; page++) {
    const result = await api<RunResult>('/api/reports/run', { ...definitionOf(request), page, pageSize: 100 })
    rows.push(...result.rows)
    total = result.total
    onProgress?.(rows.length)
    if (result.rows.length < 100 || rows.length >= total) break
  }
  return { rows: rows.slice(0, SELECT_ALL_CAP), capped: total > SELECT_ALL_CAP, total }
}

export const userLabel = (u: { name: string | null; email: string }) => u.name || u.email
export type TeamUser = { id: string; name: string | null; email: string }
export type TagOption = { id: string; name: string }
