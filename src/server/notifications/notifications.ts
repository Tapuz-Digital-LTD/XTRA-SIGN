import { and, desc, eq, isNull, sql } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'

/**
 * In-app notifications.
 *
 * Written where the thing actually happens, and never allowed to break it: a
 * document is signed whether or not we managed to record that it was. Writes
 * are idempotent by (organization, type, document), so a retried write-back or
 * a re-run reminder cannot produce a second copy of the same news.
 */

export type NotificationType = 'signed' | 'declined' | 'expired' | 'send_failed' | 'crm_failed'

export type NotificationItem = {
  id: string
  type: NotificationType
  agreementId: string | null
  title: string
  body: string | null
  readAt: Date | null
  createdAt: Date
}

export async function notify(input: {
  organizationId: string
  type: NotificationType
  agreementId: string | null
  title: string
  body?: string | null
}): Promise<void> {
  try {
    await getDb()
      .insert(schema.notifications)
      .values({
        organizationId: input.organizationId,
        type: input.type,
        agreementId: input.agreementId,
        title: input.title,
        body: input.body ?? null,
      })
      // Already told them. Not an error, and not a second row.
      .onConflictDoNothing()
  } catch (error) {
    log.error('notification write failed', { type: input.type, error: String(error) })
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
