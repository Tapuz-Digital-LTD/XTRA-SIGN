import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'

/**
 * Admin actions worth answering questions about later.
 *
 * Separate from the per-agreement audit trail: "who disabled this account"
 * belongs to the organization, not to any one document.
 */
export const AUDIT_EVENTS = {
  USER_CREATED: 'user_created',
  USER_UPDATED: 'user_updated',
  USER_DISABLED: 'user_disabled',
  USER_ENABLED: 'user_enabled',
  USER_ROLE_CHANGED: 'user_role_changed',
  LOGIN_CODE_SENT: 'login_code_sent',
  LOGIN_SUCCEEDED: 'login_succeeded',
  LOGIN_FAILED: 'login_failed',
  TEMPLATE_IMPORTED: 'template_imported',
  COMPANY_LINKED_TO_CRM: 'company_linked_to_crm',
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
  template_imported: 'יובאה תבנית מ-Fireberry',
  company_linked_to_crm: 'חברה קושרה ל-Fireberry',
  user_created: 'נוצר משתמש',
  user_updated: 'פרטי משתמש עודכנו',
  user_disabled: 'משתמש הושבת',
  user_enabled: 'משתמש הופעל',
  user_role_changed: 'הרשאה שונתה',
  login_code_sent: 'נשלח קוד כניסה',
  login_succeeded: 'כניסה למערכת',
  login_failed: 'ניסיון כניסה נכשל',
}
