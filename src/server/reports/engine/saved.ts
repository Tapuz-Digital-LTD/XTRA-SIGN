import { and, desc, eq, inArray, or } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { isReportEntity } from './query'
import type { ReportDefinition, SavedReport } from './types'

/**
 * Saved reports: a name over a definition. Personal unless shared; a shared
 * one is edited or deleted only by its owner or an admin. The definition is
 * re-validated on every run, so a saved report can never widen what its
 * reader may see.
 */

const UUID_RE = /^[0-9a-f-]{36}$/i

export function cleanDefinition(raw: unknown): ReportDefinition | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (!isReportEntity(d.entity)) return null
  const clauses = Array.isArray(d.clauses)
    ? d.clauses
        .filter((c): c is { any: unknown[] } => Boolean(c) && typeof c === 'object' && Array.isArray((c as { any?: unknown }).any))
        .map((c) => ({ any: c.any.filter((x): x is { field: string; op: string } => Boolean(x) && typeof x === 'object' && typeof (x as { field?: unknown }).field === 'string' && typeof (x as { op?: unknown }).op === 'string').map((x) => ({ field: x.field, op: x.op, value: (x as { value?: unknown }).value })) }))
        .filter((c) => c.any.length > 0)
        .slice(0, 40)
    : []
  const columns = Array.isArray(d.columns) ? d.columns.filter((c): c is string => typeof c === 'string').slice(0, 60) : []
  const s = d.sort as { field?: unknown; dir?: unknown } | null | undefined
  const sort = s && typeof s.field === 'string' ? { field: s.field, dir: s.dir === 'asc' ? ('asc' as const) : ('desc' as const) } : null
  return { entity: d.entity, clauses: clauses as ReportDefinition['clauses'], columns, sort }
}

function toView(row: typeof schema.savedReports.$inferSelect, ownerName: string | null, session: StaffSession): SavedReport {
  return { id: row.id, name: row.name, definition: row.definition as ReportDefinition, shared: row.shared, ownerUserId: row.ownerUserId, ownerName, updatedAt: row.updatedAt.toISOString(), mine: row.ownerUserId === session.userId }
}

export async function listSavedReports(session: StaffSession): Promise<SavedReport[]> {
  const db = getDb()
  const rows = await db
    .select()
    .from(schema.savedReports)
    .where(and(eq(schema.savedReports.organizationId, session.organizationId), or(eq(schema.savedReports.ownerUserId, session.userId), eq(schema.savedReports.shared, true))))
    .orderBy(desc(schema.savedReports.updatedAt))
    .limit(200)
  const ownerIds = [...new Set(rows.map((r) => r.ownerUserId))]
  const users = ownerIds.length ? await db.select({ id: schema.users.id, name: schema.users.name, email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, ownerIds)) : []
  return rows.map((r) => toView(r, users.find((u) => u.id === r.ownerUserId)?.name ?? null, session))
}

export async function getSavedReport(session: StaffSession, id: string): Promise<SavedReport | null> {
  if (!UUID_RE.test(id)) return null
  const [row] = await getDb()
    .select()
    .from(schema.savedReports)
    .where(and(eq(schema.savedReports.id, id), eq(schema.savedReports.organizationId, session.organizationId), or(eq(schema.savedReports.ownerUserId, session.userId), eq(schema.savedReports.shared, true))))
    .limit(1)
  return row ? toView(row, null, session) : null
}

export async function createSavedReport(session: StaffSession, input: { name: unknown; definition: unknown; shared?: unknown }): Promise<{ ok: true; report: SavedReport } | { ok: false; message: string }> {
  const name = typeof input.name === 'string' ? input.name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
  if (!name) return { ok: false, message: 'תנו לדוח שם.' }
  const definition = cleanDefinition(input.definition)
  if (!definition) return { ok: false, message: 'הגדרת הדוח לא תקינה.' }
  const [row] = await getDb()
    .insert(schema.savedReports)
    .values({ organizationId: session.organizationId, ownerUserId: session.userId, name, entity: definition.entity, definition, shared: input.shared === true })
    .returning()
  return { ok: true, report: toView(row, session.name, session) }
}

async function ownedForEdit(session: StaffSession, id: string) {
  if (!UUID_RE.test(id)) return null
  const [row] = await getDb().select().from(schema.savedReports).where(and(eq(schema.savedReports.id, id), eq(schema.savedReports.organizationId, session.organizationId))).limit(1)
  if (!row) return null
  if (row.ownerUserId !== session.userId && !session.isAdmin) return null
  return row
}

export async function updateSavedReport(session: StaffSession, id: string, patch: { name?: unknown; definition?: unknown; shared?: unknown }): Promise<{ ok: true; report: SavedReport } | { ok: false; message: string }> {
  const row = await ownedForEdit(session, id)
  if (!row) return { ok: false, message: 'הדוח לא נמצא, או שרק מי ששמר אותו יכול לשנות אותו.' }
  const set: Partial<typeof schema.savedReports.$inferInsert> = { updatedAt: new Date() }
  if (patch.name !== undefined) {
    const name = typeof patch.name === 'string' ? patch.name.replace(/\s+/g, ' ').trim().slice(0, 120) : ''
    if (!name) return { ok: false, message: 'תנו לדוח שם.' }
    set.name = name
  }
  if (patch.definition !== undefined) {
    const definition = cleanDefinition(patch.definition)
    if (!definition) return { ok: false, message: 'הגדרת הדוח לא תקינה.' }
    set.definition = definition
    set.entity = definition.entity
  }
  if (patch.shared !== undefined) set.shared = patch.shared === true
  const [updated] = await getDb().update(schema.savedReports).set(set).where(eq(schema.savedReports.id, row.id)).returning()
  return { ok: true, report: toView(updated, null, session) }
}

export async function deleteSavedReport(session: StaffSession, id: string): Promise<{ ok: true } | { ok: false; message: string }> {
  const row = await ownedForEdit(session, id)
  if (!row) return { ok: false, message: 'הדוח לא נמצא, או שרק מי ששמר אותו יכול למחוק אותו.' }
  await getDb().delete(schema.savedReports).where(eq(schema.savedReports.id, row.id))
  return { ok: true }
}
