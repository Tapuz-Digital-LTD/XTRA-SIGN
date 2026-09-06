import { eq } from 'drizzle-orm'
import type { StaffSession } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeGroup } from '@/server/groups/groups'

/**
 * A project's notification settings: where its news goes, which news, and
 * how the signer's own confirmation is sent.
 *
 * The addresses live in `groups.notify_emails`, the rest in
 * `groups.notification_config`. Both are read leniently: a project made
 * before this existed has everything on and nothing customised, which is
 * the point — a new campaign works without visiting this screen.
 */

export { PROJECT_EVENTS }
export type { ProjectEventKey, ProjectNotificationSettings, SignerCopySettings } from '@/lib/project-notifications'
import { PROJECT_EVENTS, type ProjectEventKey, type ProjectNotificationSettings } from '@/lib/project-notifications'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function notificationConfigOf(raw: unknown, notifyEmails: unknown): ProjectNotificationSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { events?: Record<string, unknown>; signerCopy?: Record<string, unknown> }
  const events = Object.fromEntries(PROJECT_EVENTS.map((e) => [e.key, r.events?.[e.key] !== false])) as Record<ProjectEventKey, boolean>
  const sc = r.signerCopy ?? {}
  return {
    emails: Array.isArray(notifyEmails) ? (notifyEmails as unknown[]).filter((e): e is string => typeof e === 'string') : [],
    events,
    signerCopy: {
      enabled: sc.enabled !== false,
      replyTo: typeof sc.replyTo === 'string' && EMAIL_RE.test(sc.replyTo) ? sc.replyTo : null,
      senderName: typeof sc.senderName === 'string' && sc.senderName.trim() ? sc.senderName.trim().slice(0, 60) : null,
      note: typeof sc.note === 'string' && sc.note.trim() ? sc.note.trim().slice(0, 300) : null,
      attachPdf: sc.attachPdf === true,
    },
  }
}

export async function getProjectNotificationSettings(session: StaffSession, groupId: string): Promise<ProjectNotificationSettings> {
  const group = await authorizeGroup(session, groupId)
  return notificationConfigOf(group.notificationConfig, group.notifyEmails)
}

export type SaveNotificationResult = { ok: true; settings: ProjectNotificationSettings } | { ok: false; message: string }

export async function saveProjectNotificationSettings(
  session: StaffSession,
  groupId: string,
  input: Partial<ProjectNotificationSettings>,
): Promise<SaveNotificationResult> {
  const group = await authorizeGroup(session, groupId)
  const current = notificationConfigOf(group.notificationConfig, group.notifyEmails)

  let emails = current.emails
  if (input.emails) {
    const cleaned = [...new Set(input.emails.map((e) => String(e).trim().toLowerCase()).filter(Boolean))]
    const bad = cleaned.find((e) => !EMAIL_RE.test(e))
    if (bad) return { ok: false, message: `הכתובת "${bad}" אינה תקינה.` }
    if (cleaned.length > 20) return { ok: false, message: 'ניתן להגדיר עד 20 כתובות.' }
    emails = cleaned
  }
  if (input.signerCopy?.replyTo && !EMAIL_RE.test(input.signerCopy.replyTo)) return { ok: false, message: 'כתובת ה-Reply-to אינה תקינה.' }

  const next = notificationConfigOf(
    {
      events: { ...current.events, ...(input.events ?? {}) },
      signerCopy: { ...current.signerCopy, ...(input.signerCopy ?? {}) },
    },
    emails,
  )
  await getDb()
    .update(schema.groups)
    .set({ notifyEmails: next.emails, notificationConfig: { events: next.events, signerCopy: next.signerCopy } })
    .where(eq(schema.groups.id, group.id))
  return { ok: true, settings: next }
}

/** For the senders: no session, just the project. */
export async function projectNotificationSettings(groupId: string): Promise<ProjectNotificationSettings | null> {
  const [group] = await getDb()
    .select({ notificationConfig: schema.groups.notificationConfig, notifyEmails: schema.groups.notifyEmails })
    .from(schema.groups)
    .where(eq(schema.groups.id, groupId))
    .limit(1)
  return group ? notificationConfigOf(group.notificationConfig, group.notifyEmails) : null
}
