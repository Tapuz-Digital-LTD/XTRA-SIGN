import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'

/**
 * Admin actions worth answering questions about later.
 *
 * Separate from the per-agreement audit trail: "who disabled this account"
 * belongs to the organization, not to any one document.
 */
export const AUDIT_EVENTS = {
  USER_INVITED: 'user_invited',
  INVITATION_ACCEPTED: 'invitation_accepted',
  USER_DISABLED: 'user_disabled',
  USER_ENABLED: 'user_enabled',
  USER_ROLE_CHANGED: 'user_role_changed',
  PASSWORD_RESET_REQUESTED: 'password_reset_requested',
  PASSWORD_RESET_COMPLETED: 'password_reset_completed',
  LOGIN_SUCCEEDED: 'login_succeeded',
  LOGIN_FAILED: 'login_failed',
} as const

export type AdminAuditType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS]

export async function recordAdminAction(input: {
  organizationId: string
  type: AdminAuditType
  actorEmail: string
  targetEmail?: string | null
  ip?: string | null
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await getDb().insert(schema.adminAuditEvents).values({
      organizationId: input.organizationId,
      type: input.type,
      actorEmail: input.actorEmail,
      targetEmail: input.targetEmail ?? null,
      ip: input.ip ?? null,
      metadata: input.metadata ?? null,
    })
  } catch (error) {
    // An audit write must never take down the action it describes; the action
    // has already happened either way.
    log.error('admin audit write failed', { type: input.type, error: String(error) })
  }
}

/** Hebrew labels. Internal names never reach a screen. */
export const ADMIN_AUDIT_LABELS: Record<string, string> = {
  user_invited: 'הוזמן משתמש',
  invitation_accepted: 'הזמנה אושרה',
  user_disabled: 'משתמש הושבת',
  user_enabled: 'משתמש הופעל',
  user_role_changed: 'הרשאה שונתה',
  password_reset_requested: 'התבקש איפוס סיסמה',
  password_reset_completed: 'סיסמה אופסה',
  login_succeeded: 'כניסה למערכת',
  login_failed: 'ניסיון כניסה נכשל',
}
