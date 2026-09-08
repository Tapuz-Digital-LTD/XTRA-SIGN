import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { isUuid } from '@/server/documents/authorization'
import { log } from '@/server/log'
import { isTaskKind, isTaskStatus, TASK_KINDS, type TaskKind, type TaskStatus } from './labels'

/**
 * Follow-up tasks: what the team still has to do after a signature.
 *
 * Not a task system. A campaign says which built-in task a signature creates
 * ("הקמת מוצר באתר"), one row per registration and kind appears by itself
 * when the agreement is signed, and a person moves it through four states.
 * The agreement's own status is untouched: a signed agreement stays "נחתם"
 * whatever happens to the task.
 */

export { TASK_KINDS, TASK_STATUSES, isTaskKind, isTaskStatus, summarizeTask, type TaskKind, type TaskStatus, type TaskSummary } from './labels'

export type Task = typeof schema.followUpTasks.$inferSelect
export type TaskCounts = Record<TaskStatus, number>
export type FollowUpConfig = { afterSign: TaskKind[] }

/** Whatever is stored (or sent), reduced to known kinds. */
export function cleanFollowUpConfig(raw: unknown): FollowUpConfig {
  const list = raw && typeof raw === 'object' ? (raw as { afterSign?: unknown }).afterSign : null
  const afterSign = Array.isArray(list) ? [...new Set(list.filter(isTaskKind))] : []
  return { afterSign }
}

export async function followUpConfigFor(groupId: string): Promise<FollowUpConfig> {
  const [group] = await getDb().select({ config: schema.groups.followUpConfig }).from(schema.groups).where(eq(schema.groups.id, groupId)).limit(1)
  return cleanFollowUpConfig(group?.config)
}

type LeadForTask = { id: string; organizationId: string; groupId: string; companyId: string | null; agreementId: string | null }

function taskValues(lead: LeadForTask, kind: TaskKind): typeof schema.followUpTasks.$inferInsert {
  return {
    organizationId: lead.organizationId,
    groupId: lead.groupId,
    leadId: lead.id,
    agreementId: lead.agreementId,
    companyId: lead.companyId,
    kind,
    title: TASK_KINDS[kind].label,
  }
}

/**
 * The hook a completed signature calls. Best effort and silent: the signature
 * is already final, and a missing task is visible on the report while a
 * failed signature response is not.
 */
export async function createTasksAfterSignature(agreementId: string): Promise<void> {
  try {
    const db = getDb()
    const [lead] = await db
      .select({ id: schema.projectLeads.id, organizationId: schema.projectLeads.organizationId, groupId: schema.projectLeads.groupId, companyId: schema.projectLeads.companyId, agreementId: schema.projectLeads.agreementId })
      .from(schema.projectLeads)
      .where(eq(schema.projectLeads.agreementId, agreementId))
      .limit(1)
    if (!lead) return
    const { afterSign } = await followUpConfigFor(lead.groupId)
    if (afterSign.length === 0) return
    // The unique index on (lead, kind) makes a second call a no-op.
    await db.insert(schema.followUpTasks).values(afterSign.map((kind) => taskValues(lead, kind))).onConflictDoNothing()
  } catch (error) {
    log.warn('follow-up tasks not created', { agreementId, error: String(error) })
  }
}

export async function listTasks(session: StaffSession, groupId: string, filters: { status?: TaskStatus } = {}): Promise<Task[]> {
  if (!isUuid(groupId)) return []
  return getDb()
    .select()
    .from(schema.followUpTasks)
    .where(
      and(
        eq(schema.followUpTasks.organizationId, session.organizationId),
        eq(schema.followUpTasks.groupId, groupId),
        filters.status ? eq(schema.followUpTasks.status, filters.status) : undefined,
      ),
    )
    .orderBy(desc(schema.followUpTasks.createdAt))
    .limit(500)
}

export async function taskCounts(session: StaffSession, groupId: string): Promise<TaskCounts> {
  const empty: TaskCounts = { pending: 0, in_progress: 0, done: 0, not_needed: 0 }
  if (!isUuid(groupId)) return empty
  const [row] = await getDb()
    .select({
      pending: sql<number>`count(*) filter (where ${schema.followUpTasks.status} = 'pending')`,
      in_progress: sql<number>`count(*) filter (where ${schema.followUpTasks.status} = 'in_progress')`,
      done: sql<number>`count(*) filter (where ${schema.followUpTasks.status} = 'done')`,
      not_needed: sql<number>`count(*) filter (where ${schema.followUpTasks.status} = 'not_needed')`,
    })
    .from(schema.followUpTasks)
    .where(and(eq(schema.followUpTasks.organizationId, session.organizationId), eq(schema.followUpTasks.groupId, groupId)))
  return { pending: Number(row?.pending ?? 0), in_progress: Number(row?.in_progress ?? 0), done: Number(row?.done ?? 0), not_needed: Number(row?.not_needed ?? 0) }
}

/** The tasks of many registrations at once, for a table that shows one chip per row. */
export async function tasksForLeads(organizationId: string, leadIds: string[]): Promise<Map<string, Task[]>> {
  const out = new Map<string, Task[]>()
  for (let i = 0; i < leadIds.length; i += 1000) {
    const rows = await getDb()
      .select()
      .from(schema.followUpTasks)
      .where(and(eq(schema.followUpTasks.organizationId, organizationId), inArray(schema.followUpTasks.leadId, leadIds.slice(i, i + 1000))))
    for (const row of rows) {
      if (!row.leadId) continue
      const list = out.get(row.leadId) ?? []
      list.push(row)
      out.set(row.leadId, list)
    }
  }
  return out
}

export type TaskPatch = {
  status?: TaskStatus
  assigneeUserId?: string | null
  dueAt?: Date | null
  note?: string | null
  link?: string | null
}

const CLOSED: readonly string[] = ['done', 'not_needed']

/** Null when the task is not this organization's. */
export async function updateTask(session: StaffSession, taskId: string, patch: TaskPatch): Promise<Task | null> {
  if (!isUuid(taskId)) return null
  const db = getDb()
  const [task] = await db
    .select()
    .from(schema.followUpTasks)
    .where(and(eq(schema.followUpTasks.id, taskId), eq(schema.followUpTasks.organizationId, session.organizationId)))
    .limit(1)
  if (!task) return null

  const set: Partial<typeof schema.followUpTasks.$inferInsert> = { updatedAt: new Date() }
  if (patch.status !== undefined && isTaskStatus(patch.status)) {
    set.status = patch.status
    if (CLOSED.includes(patch.status)) {
      set.completedAt = task.completedAt ?? new Date()
      set.completedBy = task.completedBy ?? session.userId
    } else {
      set.completedAt = null
      set.completedBy = null
    }
  }
  if (patch.assigneeUserId !== undefined) {
    let assignee: string | null = null
    if (patch.assigneeUserId && isUuid(patch.assigneeUserId)) {
      const [user] = await db.select({ id: schema.users.id }).from(schema.users).where(and(eq(schema.users.id, patch.assigneeUserId), eq(schema.users.organizationId, session.organizationId))).limit(1)
      assignee = user?.id ?? null
    }
    set.assigneeUserId = assignee
  }
  if (patch.dueAt !== undefined) set.dueAt = patch.dueAt
  if (patch.note !== undefined) set.note = patch.note?.trim().slice(0, 2000) || null
  if (patch.link !== undefined) {
    const link = patch.link?.trim().slice(0, 500) ?? ''
    // Staff paste "www.site.co.il/product"; the badge needs something a browser opens.
    set.link = link ? (/^https?:\/\//i.test(link) ? link : `https://${link}`) : null
  }

  const [updated] = await db.update(schema.followUpTasks).set(set).where(eq(schema.followUpTasks.id, task.id)).returning()
  return updated ?? null
}

/** A registration someone made to try the form; never a real task. */
function isTestRow(data: unknown, meta: unknown): boolean {
  const d = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const m = (meta && typeof meta === 'object' ? meta : {}) as Record<string, unknown>
  const name = [d.name, d.businessName].filter((v): v is string => typeof v === 'string').join(' ')
  return name.includes('בדיק') || m.test === true
}

/**
 * Tasks for the people who signed before the campaign asked for tasks.
 * Counts are per (registration, kind): `candidates` would be created,
 * `skipped` are test rows, `created` is what an `apply` run inserted.
 */
export async function backfillTasks(groupId: string, options: { apply: boolean }): Promise<{ candidates: number; created: number; skipped: number }> {
  const result = { candidates: 0, created: 0, skipped: 0 }
  if (!isUuid(groupId)) return result
  const { afterSign } = await followUpConfigFor(groupId)
  if (afterSign.length === 0) return result

  const db = getDb()
  const leads = await db
    .select({
      id: schema.projectLeads.id,
      organizationId: schema.projectLeads.organizationId,
      groupId: schema.projectLeads.groupId,
      companyId: schema.projectLeads.companyId,
      agreementId: schema.projectLeads.agreementId,
      data: schema.projectLeads.data,
      meta: schema.projectLeads.meta,
    })
    .from(schema.projectLeads)
    .innerJoin(schema.agreements, eq(schema.agreements.id, schema.projectLeads.agreementId))
    .where(and(eq(schema.projectLeads.groupId, groupId), eq(schema.agreements.status, 'signed')))
  if (leads.length === 0) return result

  const existing = await tasksForLeads(leads[0].organizationId, leads.map((l) => l.id))
  const values: (typeof schema.followUpTasks.$inferInsert)[] = []
  for (const lead of leads) {
    const have = new Set((existing.get(lead.id) ?? []).map((t) => t.kind))
    for (const kind of afterSign) {
      if (have.has(kind)) continue
      if (isTestRow(lead.data, lead.meta)) {
        result.skipped++
        continue
      }
      result.candidates++
      values.push(taskValues(lead, kind))
    }
  }
  if (options.apply && values.length > 0) {
    const inserted = await db.insert(schema.followUpTasks).values(values).onConflictDoNothing().returning({ id: schema.followUpTasks.id })
    result.created = inserted.length
  }
  return result
}

/** A company's tasks, newest first — the card on the company screen shows the first. */
export async function tasksForCompany(organizationId: string, companyId: string): Promise<Task[]> {
  if (!isUuid(companyId)) return []
  return getDb()
    .select()
    .from(schema.followUpTasks)
    .where(and(eq(schema.followUpTasks.organizationId, organizationId), eq(schema.followUpTasks.companyId, companyId)))
    .orderBy(desc(schema.followUpTasks.createdAt))
    .limit(50)
}

/**
 * The same change on many tasks — a selection on the setup table. A task
 * that is missing or another organization's is counted, not thrown: the
 * rest of the selection still goes through.
 */
export async function bulkUpdateTasks(session: StaffSession, taskIds: string[], patch: TaskPatch): Promise<{ updated: number; failed: number }> {
  let updated = 0
  let failed = 0
  for (const taskId of taskIds) {
    if (await updateTask(session, taskId, patch)) updated++
    else failed++
  }
  return { updated, failed }
}
