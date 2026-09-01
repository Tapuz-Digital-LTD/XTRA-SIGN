import type { agreementStatus } from '@/server/db/schema'

export type AgreementStatus = (typeof agreementStatus.enumValues)[number]

/**
 * Hebrew labels for the UI. Internal names (draft/sent/...) never reach a
 * screen. Every status carries a shape as well as a colour — status must not be
 * conveyed by colour alone.
 */
export const STATUS_LABELS: Record<AgreementStatus, string> = {
  draft: 'טיוטה',
  sent: 'ממתין לחתימה',
  viewed: 'נצפה',
  signed: 'נחתם',
  declined: 'נדחה',
  expired: 'פג תוקף',
  canceled: 'בוטל',
}

export const STATUS_TONE: Record<AgreementStatus, 'neutral' | 'pending' | 'success' | 'danger'> = {
  draft: 'neutral',
  sent: 'pending',
  viewed: 'pending',
  signed: 'success',
  declined: 'danger',
  expired: 'danger',
  canceled: 'neutral',
}

/** A signing link stays usable only while the request is still open. */
export const OPEN_STATUSES: AgreementStatus[] = ['sent', 'viewed']
