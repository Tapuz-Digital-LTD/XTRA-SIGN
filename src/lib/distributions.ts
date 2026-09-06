/**
 * The words and shapes of a distribution, shared by the wizard and the
 * server. Pure: no database, no request.
 */

export type DistributionChannel = 'sms' | 'email'
export type DistributionContentKind = 'campaign_link' | 'url'
export type DistributionStatus = 'draft' | 'sending' | 'sent' | 'failed'

export const DISTRIBUTION_STEPS = ['audience', 'channels', 'content', 'schedule', 'review'] as const
export type DistributionStep = (typeof DISTRIBUTION_STEPS)[number]

export const STEP_LABELS: Record<DistributionStep, string> = {
  audience: 'קהל',
  channels: 'ערוצים',
  content: 'תוכן',
  schedule: 'תזמון',
  review: 'בדיקה ושליחה',
}

export const CONTENT_KINDS: { key: DistributionContentKind; label: string; blurb: string }[] = [
  { key: 'campaign_link', label: 'קישור לעמוד הקמפיין', blurb: 'הנמענים מקבלים את הכתובת הציבורית של הקמפיין.' },
  { key: 'url', label: 'כתובת אחרת', blurb: 'קישור לכל עמוד אחר — מסמך, אתר, טופס.' },
]

export const STATUS_LABELS: Record<DistributionStatus, string> = {
  draft: 'טיוטה',
  sending: 'בשליחה',
  sent: 'נשלחה',
  failed: 'נכשלה',
}

export const CHANNEL_LABELS: Record<DistributionChannel, string> = { sms: 'SMS', email: 'אימייל' }

/** The starting words for a distribution message; the wizard lets you change them. */
export const DEFAULT_DISTRIBUTION_MESSAGE = {
  sms: 'שלום {{signer_name}}, {{campaign_name}}: {{campaign_url}}',
  email: {
    subject: '{{campaign_name}}',
    body: 'שלום {{signer_name}},\n\nמצורף קישור ל{{campaign_name}}. לחצו על הכפתור להמשך.',
    cta: 'למעבר',
  },
}

/** Sends to the same person closer than this need an admin to say so. */
export const MIN_HOURS_BETWEEN_SENDS = 24

export type DistributionDraft = {
  name: string
  channels: DistributionChannel[]
  contentKind: DistributionContentKind
  contentUrl: string
  message: { sms: string; email: { subject: string; body: string; cta: string } }
  audience: { kind: 'supplier' | 'customer'; source: 'all' | 'crm' | 'xtra'; companyIds: string[] }
  scheduledAt: string | null
}

export type DistributionListItem = {
  id: string
  name: string
  status: DistributionStatus
  channels: DistributionChannel[]
  contentKind: DistributionContentKind
  createdAt: string
  sentAt: string | null
  scheduledAt: string | null
  stats: { total: number; sent: number; failed: number; skipped: number }
}
