import { and, desc, eq, isNotNull, isNull, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { publicBaseUrl } from '@/server/http/public-url'
import { log } from '@/server/log'
import { InforuEmailProvider } from './inforu'
import { brandFor } from '@/server/mail/brand'
import { renderEmail } from '@/server/mail/render'
import { NoticeEmail } from '@/server/mail/templates'
import { projectNotificationSettings, type ProjectEventKey } from '@/server/projects/notification-settings'

/**
 * In-app notifications.
 *
 * Written where the thing actually happens, and never allowed to break it: a
 * document is signed whether or not we managed to record that it was. Writes
 * are idempotent by (organization, type, document), so a retried write-back or
 * a re-run reminder cannot produce a second copy of the same news.
 */

export type NotificationType = 'signed' | 'declined' | 'expired' | 'send_failed' | 'crm_failed' | 'new_lead' | 'deletion_request'

export type NotificationItem = {
  id: string
  type: NotificationType
  agreementId: string | null
  link: string | null
  title: string
  body: string | null
  readAt: Date | null
  createdAt: Date
}

/**
 * Where event emails go, and which events send one. Held on the organization
 * row and edited as a whole from the notifications settings screen.
 */
export type NotificationPrefs = {
  emails: string[]
  /** Keyed by event name; a missing key means enabled. */
  events: Record<string, boolean>
}

/** Signed / new lead / failures are news someone waits for — those mail at once.
 *  "Unsigned for days" and "about to expire" arrive as the daily digest instead. */
const IMMEDIATE_EMAIL_TYPES = new Set<NotificationType>(['signed', 'new_lead', 'send_failed', 'crm_failed', 'deletion_request'])

/** Which project switch governs each event the project's addresses may hear about. */
const PROJECT_EVENT_FOR: Partial<Record<NotificationType, ProjectEventKey>> = {
  new_lead: 'new_registration',
  signed: 'signed',
  send_failed: 'send_failed',
}

export function publicUrl(path: string): string {
  return `${publicBaseUrl()}${path.startsWith('/') ? path : `/${path}`}`
}


export async function getNotificationPrefs(organizationId: string): Promise<NotificationPrefs> {
  const [row] = await getDb()
    .select({ prefs: schema.organizations.notificationPrefs })
    .from(schema.organizations)
    .where(eq(schema.organizations.id, organizationId))
    .limit(1)

  const raw = (row?.prefs ?? {}) as Partial<NotificationPrefs>
  return {
    emails: Array.isArray(raw.emails) ? raw.emails.filter((e): e is string => typeof e === 'string') : [],
    events: raw.events && typeof raw.events === 'object' ? raw.events : {},
  }
}

export async function saveNotificationPrefs(session: StaffSession, prefs: NotificationPrefs): Promise<void> {
  const emails = prefs.emails
    .map((e) => e.trim().toLowerCase())
    .filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))
    .slice(0, 20)
  await getDb()
    .update(schema.organizations)
    .set({ notificationPrefs: { emails, events: prefs.events ?? {} } })
    .where(eq(schema.organizations.id, session.organizationId))
}

export async function notify(input: {
  organizationId: string
  type: NotificationType
  agreementId: string | null
  title: string
  body?: string | null
  /** Where clicking goes when it is not about an agreement (a lead, say). */
  link?: string | null
  /** Extra addresses beyond the organization's — a project's own list. */
  extraEmails?: string[]
  /**
   * The project this is about. Its settings decide whether its addresses
   * hear about this kind of event; the organization's settings still decide
   * for the organization's addresses.
   */
  projectId?: string | null
  /** A fully written email instead of the plain title/body one. */
  email?: { subject: string; html: string; text: string } | null
  /** Sender details for the email, when the project asks for them. */
  sender?: { replyTo?: string | null; fromName?: string | null } | null
}): Promise<void> {
  let inserted = false
  try {
    const rows = await getDb()
      .insert(schema.notifications)
      .values({
        organizationId: input.organizationId,
        type: input.type,
        agreementId: input.agreementId,
        link: input.link ?? null,
        title: input.title,
        body: input.body ?? null,
      })
      // Already told them. Not an error, and not a second row.
      .onConflictDoNothing()
      .returning({ id: schema.notifications.id })
    inserted = rows.length > 0
  } catch (error) {
    log.error('notification write failed', { type: input.type, error: String(error) })
  }

  // Email follows the in-app row: only for genuinely new news, only for the
  // immediate event types, and never allowed to fail the caller.
  if (!inserted || !IMMEDIATE_EMAIL_TYPES.has(input.type)) return
  try {
    const prefs = await getNotificationPrefs(input.organizationId)
    const orgWants = prefs.events[input.type] !== false

    // The project's addresses follow the project's switches; the
    // organization's follow the organization's.
    let projectWants = true
    if (input.projectId) {
      const settings = await projectNotificationSettings(input.projectId)
      const key = PROJECT_EVENT_FOR[input.type]
      projectWants = !settings || !key || settings.events[key] !== false
    }
    const addresses = [...new Set([...(orgWants ? prefs.emails : []), ...(projectWants ? (input.extraEmails ?? []) : [])])]
    if (addresses.length === 0) return

    const link = input.link
      ? publicUrl(input.link)
      : input.agreementId
        ? publicUrl(`/documents/${input.agreementId}`)
        : publicUrl('/')

    const email = new InforuEmailProvider()
    const content =
      input.email ??
      (await renderEmail(
        input.title,
        NoticeEmail({ brand: await brandFor({ organizationId: input.organizationId }), title: input.title, body: input.body, ctaLabel: 'לצפייה במערכת', ctaUrl: link }),
      ))
    const results = await Promise.allSettled(
      addresses.map((to) =>
        email.send({ to, ...content, replyTo: input.sender?.replyTo ?? undefined, fromName: input.sender?.fromName ?? undefined }),
      ),
    )
    const failed = results.filter((r) => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.ok)).length
    if (failed > 0) log.warn('notification email partly failed', { type: input.type, failed, total: addresses.length })
  } catch (error) {
    log.error('notification email failed', { type: input.type, error: String(error) })
  }
}

export async function listNotifications(
  session: StaffSession,
  limit = 30,
): Promise<{ items: NotificationItem[]; unread: number }> {
  const db = getDb()
  const [items, [count]] = await Promise.all([
    db
      .select()
      .from(schema.notifications)
      .where(eq(schema.notifications.organizationId, session.organizationId))
      .orderBy(desc(schema.notifications.createdAt))
      .limit(limit),
    db
      .select({ unread: sql<number>`count(*)` })
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.organizationId, session.organizationId),
          isNull(schema.notifications.readAt),
        ),
      ),
  ])

  return {
    items: items.map((row) => ({
      id: row.id,
      type: row.type as NotificationType,
      agreementId: row.agreementId,
      link: row.link,
      title: row.title,
      body: row.body,
      readAt: row.readAt,
      createdAt: row.createdAt,
    })),
    unread: Number(count?.unread ?? 0),
  }
}

/** Marks one as read, or all of them. Scoped to the caller's organization. */
/** Notifications are not records; a person may throw them away. */
export async function deleteNotification(session: StaffSession, id: string): Promise<void> {
  await getDb()
    .delete(schema.notifications)
    .where(and(eq(schema.notifications.id, id), eq(schema.notifications.organizationId, session.organizationId)))
}

export async function clearReadNotifications(session: StaffSession): Promise<number> {
  const rows = await getDb()
    .delete(schema.notifications)
    .where(and(eq(schema.notifications.organizationId, session.organizationId), isNotNull(schema.notifications.readAt)))
    .returning({ id: schema.notifications.id })
  return rows.length
}

export async function markRead(session: StaffSession, id?: string): Promise<void> {
  const db = getDb()
  const where = id
    ? and(
        eq(schema.notifications.organizationId, session.organizationId),
        eq(schema.notifications.id, id),
      )
    : and(
        eq(schema.notifications.organizationId, session.organizationId),
        isNull(schema.notifications.readAt),
      )
  await db.update(schema.notifications).set({ readAt: new Date() }).where(where)
}
