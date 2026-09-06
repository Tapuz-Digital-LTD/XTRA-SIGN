/**
 * Campaigns, in the words the product uses.
 *
 * A campaign is the business envelope (the `groups` table underneath —
 * never renamed). Two kinds, and only two: a **public** campaign has a page
 * or form that strangers join through; a **signature** campaign starts from
 * people we already have. Either may send distributions; neither has to.
 */

export type CampaignKind = 'public' | 'signature'

export const CAMPAIGN_KINDS: { key: CampaignKind; label: string; badge: string; blurb: string }[] = [
  { key: 'public', label: 'קמפיין ציבורי', badge: 'ציבורי', blurb: 'לפרסם פעילות, לאסוף הרשמות ולחבר דף/טופס ציבורי.' },
  { key: 'signature', label: 'קמפיין חתימות', badge: 'חתימות', blurb: 'לשלוח הסכמים לספקים או לקוחות שכבר יש לי.' },
]

export function isCampaignKind(value: unknown): value is CampaignKind {
  return value === 'public' || value === 'signature'
}

export const kindLabel = (kind: CampaignKind) => CAMPAIGN_KINDS.find((k) => k.key === kind)!.badge

/** The tabs a campaign shows, by kind. Tabs that do not apply are not shown. */
export type CampaignTab = 'overview' | 'audience' | 'distributions' | 'registrations' | 'agreements' | 'reports' | 'settings'

export const TABS_BY_KIND: Record<CampaignKind, CampaignTab[]> = {
  public: ['overview', 'audience', 'distributions', 'registrations', 'agreements', 'reports', 'settings'],
  signature: ['overview', 'audience', 'distributions', 'agreements', 'reports', 'settings'],
}

export const TAB_LABELS: Record<CampaignTab, string> = {
  overview: 'סקירה',
  audience: 'קהל',
  distributions: 'הפצות',
  registrations: 'הרשמות',
  agreements: 'הסכמים',
  reports: 'דוחות',
  settings: 'הגדרות',
}

/** Old links said ?tab=suppliers / ?tab=leads; they still land somewhere sensible. */
export const LEGACY_TABS: Record<string, CampaignTab> = { suppliers: 'audience', leads: 'registrations' }

/** How people join a public campaign — what the wizard asks, what settings later show. */
export type JoinMethod = 'form' | 'embed' | 'api' | 'custom'

export const JOIN_METHODS: { key: JoinMethod; label: string; blurb: string }[] = [
  { key: 'form', label: 'טופס ציבורי של XTRA Sign', blurb: 'המערכת נותנת כתובת מוכנה לשיתוף.' },
  { key: 'embed', label: 'הטמעת הטופס באתר שלי', blurb: 'קוד הטמעה ל-Wix, Shopify, WordPress, React או כל אתר שתומך בהטמעה.' },
  { key: 'api', label: 'חיבור דרך API', blurb: 'למי שבונה דף נחיתה בעצמו ורוצה לשלוח הרשמות ל-XTRA Sign.' },
  { key: 'custom', label: 'דף קמפיין מותאם אישית', blurb: 'דף קמפיין מותאם אישית אינו נבנה בתוך XTRA Sign. לצורך עיצוב ופיתוח דף ייעודי יש לפנות למפתח.' },
]

export type AfterRegistration = 'save' | 'auto_sign'

export const AFTER_REGISTRATION_OPTIONS: { key: AfterRegistration; label: string; blurb: string }[] = [
  { key: 'save', label: 'שמור הרשמה', blurb: 'ההרשמה נשמרת והצוות מטפל בהמשך.' },
  { key: 'auto_sign', label: 'הרשמה וחתימה אוטומטית', blurb: 'הנרשם הופך לספק, מקבל הסכם, מאמת טלפון וחותם — בלי שלב ידני.' },
]

/** Registrations are open unless the campaign ended and did not ask to stay open. */
export function registrationsOpen(campaign: { endsAt: Date | string | null; registrationsAfterEnd: boolean }, now = new Date()): boolean {
  if (!campaign.endsAt) return true
  if (campaign.registrationsAfterEnd) return true
  return new Date(campaign.endsAt).getTime() > now.getTime()
}

export const REGISTRATIONS_CLOSED_MESSAGE = 'ההרשמה לקמפיין הסתיימה.'
