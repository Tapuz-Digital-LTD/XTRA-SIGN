import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import { requireAdmin, type StaffSession } from '@/server/auth/session'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { cancelAgreement, deleteDraft } from '@/server/documents/lifecycle'
import { authorizeGroup } from '@/server/groups/groups'
import { notify } from '@/server/notifications/notifications'
import { authorizeTemplateAccess } from '@/server/templates/templates'
import { getStorage } from '@/server/storage/blob'
import { AUDIT_EVENTS as ADMIN_AUDIT, recordAdminAction } from '@/server/users/admin-audit'

/**
 * One policy for removing anything.
 *
 * Every screen asks the same two questions: "what is behind this record?"
 * and "what may I do about it?" — and gets the same answers, from here.
 * The rule is simple to say: a record with nothing behind it is deleted; a
 * record with unsigned work behind it is deleted after that work is
 * cancelled, and the record is told what will happen; a record with signed
 * history is never deleted through the product — it is archived, or an
 * admin removes it from every screen while its signed files and audit
 * trail stay exactly where they are. Archive and delete are two different
 * things: not wanting to see a supplier any more never costs a signed PDF.
 *
 * Nothing here talks to the CRM. A company that came from Fireberry is
 * archived or removed in XTRA Sign only.
 */

export type EntityType = 'company' | 'project' | 'template' | 'agreement' | 'lead' | 'notification'

export type RecommendedAction = 'delete' | 'delete_with_cancel' | 'archive' | 'protected_delete' | 'keep'

export type DeletionImpact = {
  entityType: EntityType
  entityId: string
  name: string
  /** Nothing behind it: a plain delete is allowed. */
  canHardDelete: boolean
  /** Signed history behind it: only an admin may remove it, and only protected. */
  requiresAdmin: boolean
  signedAgreements: number
  openAgreements: number
  draftAgreements: number
  dependentRecords: { label: string; count: number }[]
  recommendedAction: RecommendedAction
  /** The record is a mirror of a CRM record; nothing happens there. */
  crmLinked: boolean
  archived: boolean
  /** When the record cannot be removed at all, why. */
  keepReason: string | null
}

export type DeletionMode = 'delete' | 'archive' | 'restore' | 'protected'

export type DeletionResult =
  | { ok: true; action: DeletionMode; message: string }
  | { ok: false; message: string; requiresAdmin?: boolean }

const OPEN = ['sent', 'viewed'] as const

// ── impact ────────────────────────────────────────────────────────────────

export async function getDeletionImpact(session: StaffSession, type: EntityType, id: string): Promise<DeletionImpact> {
  switch (type) {
    case 'company':
      return companyImpact(session, id)
    case 'project':
      return projectImpact(session, id)
    case 'template':
      return templateImpact(session, id)
    case 'agreement':
      return agreementImpact(session, id)
    case 'lead':
      return leadImpact(session, id)
    case 'notification':
      return notificationImpact(session, id)
  }
}

function decide(input: {
  signed: number
  open: number
  drafts: number
  otherHistory?: number
}): Pick<DeletionImpact, 'canHardDelete' | 'requiresAdmin' | 'recommendedAction'> {
  if (input.signed > 0) return { canHardDelete: false, requiresAdmin: true, recommendedAction: 'archive' }
  if (input.open + input.drafts > 0) return { canHardDelete: false, requiresAdmin: false, recommendedAction: 'delete_with_cancel' }
  if ((input.otherHistory ?? 0) > 0) return { canHardDelete: false, requiresAdmin: false, recommendedAction: 'archive' }
  return { canHardDelete: true, requiresAdmin: false, recommendedAction: 'delete' }
}

async function agreementCounts(where: ReturnType<typeof sql>) {
  const [row] = await getDb()
    .select({
      signed: sql<number>`count(*) filter (where ${schema.agreements.status} = 'signed')`,
      open: sql<number>`count(*) filter (where ${schema.agreements.status} in ('sent', 'viewed'))`,
      drafts: sql<number>`count(*) filter (where ${schema.agreements.status} = 'draft')`,
      other: sql<number>`count(*) filter (where ${schema.agreements.status} in ('expired', 'canceled', 'declined'))`,
    })
    .from(schema.agreements)
    .where(and(where, isNull(schema.agreements.deletedAt)))
  return { signed: Number(row?.signed ?? 0), open: Number(row?.open ?? 0), drafts: Number(row?.drafts ?? 0), other: Number(row?.other ?? 0) }
}

async function loadCompany(session: StaffSession, id: string) {
  const [company] = await getDb()
    .select()
    .from(schema.companies)
    .where(and(eq(schema.companies.id, id), eq(schema.companies.organizationId, session.organizationId), isNull(schema.companies.deletedAt)))
    .limit(1)
  if (!company) throw new NotFound()
  return company
}

async function companyImpact(session: StaffSession, id: string): Promise<DeletionImpact> {
  const company = await loadCompany(session, id)
  const db = getDb()
  const counts = await agreementCounts(eq(schema.agreements.companyId, id))
  const [deps] = await db
    .select({
      projects: sql<number>`(select count(*) from ${schema.companyGroups} cg where cg.company_id = ${id})`,
      leads: sql<number>`(select count(*) from ${schema.projectLeads} pl where pl.company_id = ${id})`,
      batchItems: sql<number>`(select count(*) from ${schema.bulkBatchItems} bi where bi.company_id = ${id})`,
    })
    .from(sql`(select 1) as one`)
  const decision = decide(counts)
  return {
    entityType: 'company',
    entityId: id,
    name: company.name,
    ...decision,
    canHardDelete: decision.canHardDelete && Number(deps?.batchItems ?? 0) === 0,
    signedAgreements: counts.signed,
    openAgreements: counts.open,
    draftAgreements: counts.drafts,
    dependentRecords: [
      { label: company.kind === 'supplier' ? 'שיוך לפרויקטים' : 'שיוך לקבוצות', count: Number(deps?.projects ?? 0) },
      { label: 'הרשמות / לידים', count: Number(deps?.leads ?? 0) },
      { label: 'הסכמים שהסתיימו ללא חתימה', count: counts.other },
    ].filter((d) => d.count > 0),
    crmLinked: Boolean(company.crmRecordId),
    archived: Boolean(company.archivedAt),
    keepReason: null,
  }
}

/** Every agreement a project produced, through either door. */
function projectAgreementIds(groupId: string) {
  return sql`${schema.agreements.id} in (
    select pl.agreement_id from ${schema.projectLeads} pl where pl.group_id = ${groupId} and pl.agreement_id is not null
    union
    select bi.agreement_id from ${schema.bulkBatchItems} bi
      join ${schema.bulkBatches} bb on bb.id = bi.batch_id
      where bb.group_id = ${groupId} and bi.agreement_id is not null
  )`
}

async function projectImpact(session: StaffSession, id: string): Promise<DeletionImpact> {
  const group = await authorizeGroup(session, id)
  const counts = await agreementCounts(projectAgreementIds(id))
  const [deps] = await getDb()
    .select({
      members: sql<number>`(select count(*) from ${schema.companyGroups} cg where cg.group_id = ${id})`,
      leads: sql<number>`(select count(*) from ${schema.projectLeads} pl where pl.group_id = ${id})`,
      slugs: sql<number>`(select count(*) from ${schema.projectPublicSlugs} s where s.group_id = ${id})`,
    })
    .from(sql`(select 1) as one`)
  return {
    entityType: 'project',
    entityId: id,
    name: group.name,
    ...decide(counts),
    signedAgreements: counts.signed,
    openAgreements: counts.open,
    draftAgreements: counts.drafts,
    dependentRecords: [
      { label: 'ספקים משויכים', count: Number(deps?.members ?? 0) },
      { label: 'הרשמות / לידים', count: Number(deps?.leads ?? 0) },
      { label: 'כתובות ציבוריות', count: Number(deps?.slugs ?? 0) },
      { label: 'הסכמים שהסתיימו ללא חתימה', count: counts.other },
    ].filter((d) => d.count > 0),
    crmLinked: false,
    archived: Boolean(group.archivedAt),
    keepReason: null,
  }
}

async function templateImpact(session: StaffSession, id: string): Promise<DeletionImpact> {
  const template = await authorizeTemplateAccess(session, id)
  const counts = await agreementCounts(eq(schema.agreements.templateId, id))
  const used = counts.signed + counts.open + counts.drafts + counts.other
  return {
    entityType: 'template',
    entityId: id,
    name: template.name,
    // A used template is hidden, never deleted: the agreements made from it
    // keep their own copies, but the record of "made from this" stays.
    canHardDelete: used === 0,
    requiresAdmin: false,
    recommendedAction: used === 0 ? 'delete' : 'archive',
    signedAgreements: counts.signed,
    openAgreements: counts.open,
    draftAgreements: counts.drafts,
    dependentRecords: [{ label: 'הסכמים שנוצרו מהתבנית', count: used }].filter((d) => d.count > 0),
    crmLinked: false,
    archived: false,
    keepReason: null,
  }
}

async function agreementImpact(session: StaffSession, id: string): Promise<DeletionImpact> {
  const agreement = await authorizeAgreementAccess(session, id)
  const [flags] = await getDb()
    .select({ archivedAt: schema.agreements.archivedAt })
    .from(schema.agreements)
    .where(eq(schema.agreements.id, id))
    .limit(1)
  const signed = agreement.status === 'signed' ? 1 : 0
  const open = (OPEN as readonly string[]).includes(agreement.status) ? 1 : 0
  const drafts = agreement.status === 'draft' ? 1 : 0
  const decision = decide({ signed, open, drafts, otherHistory: signed + open + drafts === 0 ? 1 : 0 })
  return {
    entityType: 'agreement',
    entityId: id,
    name: agreement.title,
    ...decision,
    signedAgreements: signed,
    openAgreements: open,
    draftAgreements: drafts,
    dependentRecords: [],
    crmLinked: false,
    archived: Boolean(flags?.archivedAt),
    keepReason: null,
  }
}

async function leadImpact(session: StaffSession, id: string): Promise<DeletionImpact> {
  const [lead] = await getDb()
    .select()
    .from(schema.projectLeads)
    .where(and(eq(schema.projectLeads.id, id), eq(schema.projectLeads.organizationId, session.organizationId)))
    .limit(1)
  if (!lead) throw new NotFound()
  const data = (lead.data && typeof lead.data === 'object' ? lead.data : {}) as Record<string, unknown>
  const name = typeof data.name === 'string' ? data.name : typeof data.businessName === 'string' ? data.businessName : 'הרשמה'
  // A registration that became a supplier or an agreement is the project's
  // history: it carries the attribution and the idempotency key. It stays.
  const converted = Boolean(lead.agreementId || lead.companyId)
  return {
    entityType: 'lead',
    entityId: id,
    name,
    canHardDelete: !converted,
    requiresAdmin: false,
    recommendedAction: converted ? 'keep' : 'delete',
    signedAgreements: 0,
    openAgreements: 0,
    draftAgreements: 0,
    dependentRecords: [],
    crmLinked: false,
    archived: false,
    keepReason: converted ? 'ההרשמה כבר הפכה לספק או להסכם ולכן נשמרת כהיסטוריה של הפרויקט.' : null,
  }
}

async function notificationImpact(session: StaffSession, id: string): Promise<DeletionImpact> {
  const [row] = await getDb()
    .select({ id: schema.notifications.id, title: schema.notifications.title })
    .from(schema.notifications)
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.organizationId, session.organizationId)))
    .limit(1)
  if (!row) throw new NotFound()
  return {
    entityType: 'notification',
    entityId: id,
    name: row.title,
    canHardDelete: true,
    requiresAdmin: false,
    recommendedAction: 'delete',
    signedAgreements: 0,
    openAgreements: 0,
    draftAgreements: 0,
    dependentRecords: [],
    crmLinked: false,
    archived: false,
    keepReason: null,
  }
}

// ── action ────────────────────────────────────────────────────────────────

/**
 * Does the one thing the policy allows. `delete` on a record with unsigned
 * work cancels that work first; on a record with signed history it is
 * refused. `protected` is the admin's removal and needs the acknowledgement
 * the screen collects. Every outcome that changes business data lands in
 * the admin audit with who, when, what and which kind.
 */
export async function deleteEntity(
  session: StaffSession,
  type: EntityType,
  id: string,
  options: { mode: DeletionMode; acknowledged?: boolean; ip?: string | null },
): Promise<DeletionResult> {
  const impact = await getDeletionImpact(session, type, id)
  const { mode } = options

  if (impact.recommendedAction === 'keep' && mode !== 'archive') {
    return { ok: false, message: impact.keepReason ?? 'לא ניתן להסיר את הרשומה.' }
  }

  if (mode === 'protected') {
    if (!session.isAdmin) return { ok: false, message: 'מחיקה מוגנת דורשת אישור מנהל מערכת.', requiresAdmin: true }
    if (!options.acknowledged) return { ok: false, message: 'יש לאשר שההיסטוריה החתומה תישמר.' }
  }

  if (mode === 'delete' && impact.requiresAdmin) {
    return {
      ok: false,
      requiresAdmin: true,
      message:
        'לא ניתן למחוק רשומה זו באופן רגיל, משום שקיימים במערכת מסמכים חתומים או מידע היסטורי המשויך אליה. אפשר להעביר אותה לארכיון (המסמכים וההיסטוריה נשמרים), ומחיקה מלאה דורשת אישור מנהל מערכת.',
    }
  }

  const result = await perform(session, impact, mode)
  if (!result.ok) return result

  await recordAdminAction({
    organizationId: session.organizationId,
    type:
      mode === 'archive'
        ? ADMIN_AUDIT.RECORD_ARCHIVED
        : mode === 'restore'
          ? ADMIN_AUDIT.RECORD_RESTORED
          : mode === 'protected'
            ? ADMIN_AUDIT.RECORD_PROTECTED_DELETE
            : ADMIN_AUDIT.RECORD_DELETED,
    actorEmail: session.email,
    ip: options.ip ?? null,
    metadata: {
      entityType: type,
      entityId: id,
      name: impact.name,
      mode,
      signedAgreements: impact.signedAgreements,
      openAgreements: impact.openAgreements,
      draftAgreements: impact.draftAgreements,
      crmLinked: impact.crmLinked,
    },
  })
  return result
}

async function perform(session: StaffSession, impact: DeletionImpact, mode: DeletionMode): Promise<DeletionResult> {
  const db = getDb()
  const id = impact.entityId
  const now = new Date()

  switch (impact.entityType) {
    case 'company': {
      if (mode === 'archive') {
        await db.update(schema.companies).set({ archivedAt: now }).where(eq(schema.companies.id, id))
        return { ok: true, action: mode, message: 'הרשומה הועברה לארכיון. ההסכמים והקבצים החתומים נשמרו.' }
      }
      if (mode === 'restore') {
        await db.update(schema.companies).set({ archivedAt: null }).where(eq(schema.companies.id, id))
        return { ok: true, action: mode, message: 'הרשומה הוחזרה לרשימות הפעילות.' }
      }
      if (mode === 'protected') {
        // Out of every screen; agreements, signed files, audit: untouched.
        await db.update(schema.companies).set({ deletedAt: now }).where(eq(schema.companies.id, id))
        return { ok: true, action: mode, message: 'הרשומה הוסרה. ההסכמים החתומים, הקבצים והיסטוריית החתימות נשמרו.' }
      }
      // delete: unsigned work is cancelled, drafts are removed, then the record goes.
      const cancelled = await cancelOpenWork(session, eq(schema.agreements.companyId, id))
      if (!cancelled.ok) return cancelled
      if (impact.canHardDelete && cancelled.remaining === 0) {
        await db.transaction(async (tx) => {
          await tx.delete(schema.companyGroups).where(eq(schema.companyGroups.companyId, id))
          await tx.update(schema.projectLeads).set({ companyId: null }).where(eq(schema.projectLeads.companyId, id))
          await tx.delete(schema.companies).where(eq(schema.companies.id, id))
        })
      } else {
        await db.update(schema.companies).set({ deletedAt: now }).where(eq(schema.companies.id, id))
      }
      return { ok: true, action: mode, message: cancelled.cancelled > 0 ? `הרשומה נמחקה ו-${cancelled.cancelled} הסכמים בוטלו.` : 'הרשומה נמחקה.' }
    }

    case 'project': {
      if (mode === 'archive') {
        await db.update(schema.groups).set({ archivedAt: now }).where(eq(schema.groups.id, id))
        return { ok: true, action: mode, message: 'הפרויקט הועבר לארכיון.' }
      }
      if (mode === 'restore') {
        await db.update(schema.groups).set({ archivedAt: null }).where(eq(schema.groups.id, id))
        return { ok: true, action: mode, message: 'הפרויקט הוחזר לרשימה הפעילה.' }
      }
      if (mode === 'protected') {
        await db.update(schema.groups).set({ deletedAt: now }).where(eq(schema.groups.id, id))
        return { ok: true, action: mode, message: 'הפרויקט הוסר. ההסכמים החתומים והיסטוריית החתימות נשמרו.' }
      }
      const cancelled = await cancelOpenWork(session, projectAgreementIds(id))
      if (!cancelled.ok) return cancelled
      if (impact.canHardDelete && cancelled.remaining === 0) {
        await db.transaction(async (tx) => {
          await tx.delete(schema.campaignEvents).where(eq(schema.campaignEvents.groupId, id))
          await tx.delete(schema.projectPublicSlugs).where(eq(schema.projectPublicSlugs.groupId, id))
          await tx.delete(schema.projectLeads).where(eq(schema.projectLeads.groupId, id))
          await tx.delete(schema.companyGroups).where(eq(schema.companyGroups.groupId, id))
          await tx.update(schema.bulkBatches).set({ groupId: null }).where(eq(schema.bulkBatches.groupId, id))
          await tx.delete(schema.groups).where(eq(schema.groups.id, id))
        })
      } else {
        await db.update(schema.groups).set({ deletedAt: now }).where(eq(schema.groups.id, id))
      }
      return { ok: true, action: mode, message: cancelled.cancelled > 0 ? `הפרויקט נמחק ו-${cancelled.cancelled} הסכמים בוטלו.` : 'הפרויקט נמחק.' }
    }

    case 'template': {
      const template = await authorizeTemplateAccess(session, id)
      if (!(session.isAdmin || template.createdBy === session.userId)) return { ok: false, message: 'רק מי שיצר את התבנית או מנהל מערכת יכול להסיר אותה.' }
      if (mode === 'restore') return { ok: false, message: 'תבנית שהוסרה אינה ניתנת לשחזור.' }
      await db.update(schema.templates).set({ deletedAt: now }).where(eq(schema.templates.id, id))
      if (impact.canHardDelete && template.sourceFileKey) {
        // Nothing was ever made from it: the file can go too.
        await getStorage().delete(template.sourceFileKey).catch(() => {})
        return { ok: true, action: 'delete', message: 'התבנית נמחקה.' }
      }
      return { ok: true, action: 'archive', message: 'התבנית הוסרה מרשימת התבניות. הסכמים שנוצרו ממנה ממשיכים לעבוד כרגיל.' }
    }

    case 'agreement': {
      const agreement = await authorizeAgreementAccess(session, id)
      if (mode === 'archive' || (mode === 'delete' && !impact.canHardDelete && impact.openAgreements === 0)) {
        await db.update(schema.agreements).set({ archivedAt: now }).where(eq(schema.agreements.id, id))
        await audit(id, AUDIT_EVENTS.ARCHIVED, session)
        return { ok: true, action: 'archive', message: 'ההסכם הועבר לארכיון. הקובץ החתום והיסטוריית החתימה נשמרו.' }
      }
      if (mode === 'restore') {
        await db.update(schema.agreements).set({ archivedAt: null }).where(eq(schema.agreements.id, id))
        await audit(id, AUDIT_EVENTS.RESTORED, session)
        return { ok: true, action: mode, message: 'ההסכם הוחזר לרשימה.' }
      }
      if (mode === 'protected') {
        await db.update(schema.agreements).set({ deletedAt: now }).where(eq(schema.agreements.id, id))
        await audit(id, AUDIT_EVENTS.REMOVED, session)
        return { ok: true, action: mode, message: 'ההסכם הוסר מהמסכים. הקובץ החתום והיסטוריית החתימה נשמרו.' }
      }
      if (agreement.status === 'draft') {
        const removed = await deleteDraft({ session, agreementId: id })
        return removed.ok ? { ok: true, action: 'delete', message: 'הטיוטה נמחקה.' } : removed
      }
      // sent / viewed: cancel, then out of the list.
      const cancelled = await cancelAgreement({ session, agreementId: id })
      if (!cancelled.ok) return cancelled
      await db.update(schema.agreements).set({ archivedAt: now }).where(eq(schema.agreements.id, id))
      await audit(id, AUDIT_EVENTS.ARCHIVED, session)
      return { ok: true, action: 'delete', message: 'ההסכם בוטל והוסר מהרשימה.' }
    }

    case 'lead': {
      if (mode !== 'delete') return { ok: false, message: 'הרשמה נמחקת או נשמרת; אין לה ארכיון.' }
      await db.delete(schema.projectLeads).where(and(eq(schema.projectLeads.id, id), isNull(schema.projectLeads.agreementId), isNull(schema.projectLeads.companyId)))
      return { ok: true, action: mode, message: 'ההרשמה נמחקה.' }
    }

    case 'notification': {
      await db.delete(schema.notifications).where(and(eq(schema.notifications.id, id), eq(schema.notifications.organizationId, session.organizationId)))
      return { ok: true, action: 'delete', message: 'ההתראה נמחקה.' }
    }
  }
}

/**
 * Cancels every open agreement and deletes every draft the condition
 * matches. Returns how many were cancelled and how many agreements of any
 * kind still reference the record afterwards (finished ones stay).
 */
async function cancelOpenWork(session: StaffSession, where: ReturnType<typeof sql>): Promise<{ ok: true; cancelled: number; remaining: number } | { ok: false; message: string }> {
  const db = getDb()
  const rows = await db
    .select({ id: schema.agreements.id, status: schema.agreements.status })
    .from(schema.agreements)
    .where(and(where, isNull(schema.agreements.deletedAt), inArray(schema.agreements.status, ['draft', 'sent', 'viewed'])))
  let cancelled = 0
  for (const row of rows) {
    const result = row.status === 'draft' ? await deleteDraft({ session, agreementId: row.id }) : await cancelAgreement({ session, agreementId: row.id })
    if (!result.ok) return result
    if (row.status !== 'draft') cancelled++
  }
  const [left] = await db.select({ n: sql<number>`count(*)` }).from(schema.agreements).where(and(where, isNull(schema.agreements.deletedAt)))
  return { ok: true, cancelled, remaining: Number(left?.n ?? 0) }
}

async function audit(agreementId: string, type: string, session: StaffSession) {
  await getDb().insert(schema.auditEvents).values({ agreementId, type, actor: 'sender', metadata: { by: session.email } })
}

// ── asking an admin ───────────────────────────────────────────────────────

/** A person who may not remove a protected record asks the admins to. */
export async function requestAdminDeletion(session: StaffSession, type: EntityType, id: string, ip?: string | null): Promise<{ ok: true }> {
  const impact = await getDeletionImpact(session, type, id)
  const link = linkFor(type, id)
  await notify({
    organizationId: session.organizationId,
    type: 'deletion_request',
    agreementId: type === 'agreement' ? id : null,
    link,
    title: `בקשת מחיקה: ${impact.name}`,
    body: `${session.name} ביקש/ה להסיר רשומה עם היסטוריה חתומה (${impact.signedAgreements} הסכמים חתומים).`,
  })
  await recordAdminAction({
    organizationId: session.organizationId,
    type: ADMIN_AUDIT.DELETION_REQUESTED,
    actorEmail: session.email,
    ip: ip ?? null,
    metadata: { entityType: type, entityId: id, name: impact.name, signedAgreements: impact.signedAgreements },
  })
  return { ok: true }
}

function linkFor(type: EntityType, id: string): string | null {
  switch (type) {
    case 'company':
      return `/companies/${id}`
    case 'project':
      return `/projects/${id}`
    case 'template':
      return '/templates'
    case 'agreement':
      return `/documents/${id}`
    default:
      return null
  }
}

export class NotFound extends Error {
  status = 404
  constructor() {
    super('not found')
  }
}

export function isEntityType(value: unknown): value is EntityType {
  return typeof value === 'string' && ['company', 'project', 'template', 'agreement', 'lead', 'notification'].includes(value)
}

export function isDeletionMode(value: unknown): value is DeletionMode {
  return typeof value === 'string' && ['delete', 'archive', 'restore', 'protected'].includes(value)
}

export { requireAdmin }
