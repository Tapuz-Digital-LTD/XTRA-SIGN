/**
 * Audit event vocabulary. Internal names only — never rendered to a user.
 * The Hebrew UI labels live in the presentation layer.
 */
export const AUDIT_EVENTS = {
  CREATED: 'created',
  DOCUMENT_GENERATED: 'document_generated',
  SENT: 'sent',
  EMAIL_SENT: 'email_sent',
  SMS_SENT: 'sms_sent',
  EMAIL_FAILED: 'email_failed',
  SMS_FAILED: 'sms_failed',
  /**
   * The share sheet was opened — NOT that a message reached anyone. WhatsApp is
   * a client-side share; the system cannot observe delivery, so no event here
   * may ever be read as proof of receipt.
   */
  WHATSAPP_SHARE_OPENED: 'whatsapp_share_opened',
  VIEWED: 'viewed',
  OTP_SENT: 'otp_sent',
  OTP_VERIFIED: 'otp_verified',
  OTP_FAILED: 'otp_failed',
  FIELD_COMPLETED: 'field_completed',
  SIGNATURE_APPLIED: 'signature_applied',
  COMPLETED: 'completed',
  DECLINED: 'declined',
  CANCELED: 'canceled',
  EXPIRED: 'expired',
  REMINDER_SENT: 'reminder_sent',
  NEW_VERSION_CREATED: 'new_version_created',
  /** The document's PDF and layout were copied into a template. */
  SAVED_AS_TEMPLATE: 'saved_as_template',
  /** The signed PDF was pushed to the external CRM. */
  CRM_UPLOADED: 'crm_uploaded',
  /** The document was filed under a supplier or customer. */
  COMPANY_LINKED: 'company_linked',
} as const

export type AuditEventType = (typeof AUDIT_EVENTS)[keyof typeof AUDIT_EVENTS]
