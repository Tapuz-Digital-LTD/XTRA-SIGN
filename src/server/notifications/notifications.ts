import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'
import { InforuEmailProvider } from './inforu'

/**
 * In-app notifications.
 *
 * Written where the thing actually happens, and never allowed to break it: a
 * document is signed whether or not we managed to record that it was. Writes
 * are idempotent by (organization, type, document), so a retried write-back or
 * a re-run reminder cannot produce a second copy of the same news.
 */

export type NotificationType = 'signed' | 'declined' | 'expired' | 'send_failed' | 'crm_failed' | 'new_lead'

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
const IMMEDIATE_EMAIL_TYPES = new Set<NotificationType>(['signed', 'new_lead', 'send_failed', 'crm_failed'])

export function publicUrl(path: string): string {
  const base = (process.env.SIGN_PUBLIC_URL ?? 'http://localhost:3000').replace(/\/+$/, '')
  return `${base}${path.startsWith('/') ? path : `/${path}`}`
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
    if (prefs.events[input.type] === false) return

    const addresses = [...new Set([...prefs.emails, ...(input.extraEmails ?? [])])]
    if (addresses.length === 0) return

    const link = input.link
      ? publicUrl(input.link)
      : input.agreementId
        ? publicUrl(`/documents/${input.agreementId}`)
        : publicUrl('/')

    const email = new InforuEmailProvider()
    await Promise.allSettled(
      addresses.map((to) =>
        email.send({
          to,
          subject: input.title,
          text: `${input.title}\n${input.body ?? ''}\n\n${link}`,
          html: `<div dir="rtl" style="font-family:Arial,sans-serif;font-size:15px;color:#111">
            <p><strong>${input.title}</strong></p>
            ${input.body ? `<p>${input.body}</p>` : ''}
            <p><a href="${link}">לצפייה במערכת</a></p>
          </div>`,
        }),
      ),
    )
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
