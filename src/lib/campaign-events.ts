/**
 * The vocabulary of campaign analytics, shared by the pages that emit
 * events and the report that reads them.
 */

export const CAMPAIGN_EVENT_TYPES = [
  'page_view',
  'join_cta_clicked',
  'registration_started',
  'registration_completed',
  'signing_started',
  'agreement_signed',
  'thank_you_viewed',
  'signed_document_downloaded',
] as const

export type CampaignEventType = (typeof CAMPAIGN_EVENT_TYPES)[number]

export function isCampaignEventType(value: unknown): value is CampaignEventType {
  return typeof value === 'string' && (CAMPAIGN_EVENT_TYPES as readonly string[]).includes(value)
}

export const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const
export type Utm = Partial<Record<(typeof UTM_KEYS)[number], string>>

/** A visit id the browser mints for itself: opaque, unguessable enough, no meaning. */
export const VISIT_ID_RE = /^[A-Za-z0-9_-]{10,40}$/

/** The campaign tags out of a query string, capped, nothing else. */
export function utmFrom(params: URLSearchParams | Record<string, string | string[] | undefined>): Utm {
  const get = (key: string) => (params instanceof URLSearchParams ? params.get(key) : params[key])
  const utm: Utm = {}
  for (const key of UTM_KEYS) {
    const raw = get(key)
    const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 120)
    if (value) utm[key] = value
  }
  return utm
}

/**
 * Where a visit came from, as a person would name it.
 *
 * Campaign tags win over the referrer: a Facebook ad tagged `utm_source=fb`
 * is "Facebook / paid" even when the browser reports l.facebook.com. With
 * no tags, the referring host is read; with neither, the visit is direct.
 *
 * Our own addresses are never a channel. Somebody moving from the campaign
 * page to the joining page referred themselves, and printing that beside
 * Google and Facebook makes our own site look like a partner sending us
 * traffic. It is named as what it is, and a screen can leave it out.
 */
export type TrafficSource = {
  /** Stable key for grouping. */
  key: string
  label: string
  /** paid / organic / email / social / … when known. */
  medium: string | null
}

const KNOWN: { key: string; label: string; match: RegExp }[] = [
  { key: 'facebook', label: 'Facebook', match: /facebook|fb\.|\bfb\b|meta/i },
  { key: 'instagram', label: 'Instagram', match: /instagram|\big\b/i },
  { key: 'whatsapp', label: 'WhatsApp', match: /whatsapp|wa\.me/i },
  { key: 'google', label: 'Google', match: /google|adwords|gclid/i },
  { key: 'email', label: 'אימייל', match: /mail|newsletter|inforu|outlook/i },
  { key: 'sms', label: 'SMS', match: /\bsms\b/i },
  { key: 'linkedin', label: 'LinkedIn', match: /linkedin/i },
  { key: 'tiktok', label: 'TikTok', match: /tiktok/i },
  { key: 'youtube', label: 'YouTube', match: /youtube|youtu\.be/i },
  { key: 'twitter', label: 'X / Twitter', match: /twitter|\bx\.com|t\.co/i },
  { key: 'telegram', label: 'Telegram', match: /telegram|t\.me/i },
]

/** Ours: the campaign domains and the app's own hosts. */
const OURS = /(^|\.)xtra\.co\.il$|(^|\.)xtra-sign[a-z0-9-]*\.vercel\.app$|^localhost(:\d+)?$/i

const MEDIUM_LABELS: Record<string, string> = {
  cpc: 'paid',
  ppc: 'paid',
  paid: 'paid',
  paidsocial: 'paid',
  social: 'social',
  organic: 'organic',
  email: 'email',
  newsletter: 'email',
  sms: 'sms',
  referral: 'referral',
  qr: 'QR',
  print: 'print',
}

export function classifySource(utm: Utm | null | undefined, referrer: string | null | undefined): TrafficSource {
  const source = utm?.utm_source?.trim()
  const medium = utm?.utm_medium?.trim().toLowerCase()
  const mediumLabel = medium ? (MEDIUM_LABELS[medium] ?? medium.slice(0, 20)) : null

  if (source) {
    const known = KNOWN.find((k) => k.match.test(source))
    return known
      ? { key: known.key, label: known.label, medium: mediumLabel }
      : { key: `utm:${source.toLowerCase().slice(0, 40)}`, label: source.slice(0, 40), medium: mediumLabel }
  }
  if (referrer) {
    const host = referrer.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '').slice(0, 60)
    if (host && OURS.test(host)) return { key: 'internal', label: 'מעבר פנימי באתר שלנו', medium: mediumLabel ?? 'internal' }
    const known = KNOWN.find((k) => k.match.test(referrer))
    if (known) return { key: known.key, label: known.label, medium: mediumLabel ?? 'organic' }
    if (host) return { key: `ref:${host}`, label: host, medium: mediumLabel ?? 'referral' }
  }
  // "Direct" is a traffic source, never an invitation: nothing here knows
  // about personal outreach, and no screen may present it as one.
  return { key: 'direct', label: 'ישירות / לא מזוהה', medium: mediumLabel }
}

/** The host of a referring page — what the report needs, and nothing more. */
export function referrerHost(referrer: string | null | undefined): string | null {
  if (!referrer || typeof referrer !== 'string') return null
  try {
    return new URL(referrer).host.slice(0, 120) || null
  } catch {
    return null
  }
}
