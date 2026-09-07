/**
 * Campaigns, in the words the product uses.
 *
 * A campaign is the business envelope (the `groups` table underneath —
 * never renamed). Four independent choices describe one:
 *
 *   goal      — what it is for: collect inquiries, or get documents signed
 *   entry     — how people come in: an audience we already have, a public
 *               form, an embedded form, the API, or a developer-built page
 *   handling  — what happens after a form: save for the team, or register
 *               and sign automatically (needs an agreement template)
 *   distributions — SMS/email sends, optional for every campaign
 *
 * `campaignKind` ('public' | 'signature') is kept for older code and is
 * derived from the entry: anything with a form is "public".
 */

export type CampaignGoal = 'inquiries' | 'signing'

export const GOALS: { key: CampaignGoal; label: string; blurb: string }[] = [
  { key: 'inquiries', label: 'איסוף פניות (לידים)', blurb: 'טופס לאיסוף פרטים מספקים או מלקוחות. כל פנייה חדשה ממתינה לטיפול הצוות, ואפשר להמשיך ממנה לחתימה או להוסיף כספק/לקוח.' },
  { key: 'signing', label: 'החתמה על מסמכים', blurb: 'שליחת הסכמים לנמענים שנבחרו, או הרשמה וחתימה עצמאית דרך טופס. המערכת מנהלת את ההסכמים, החתימות והמסמכים החתומים.' },
]

export function isCampaignGoal(value: unknown): value is CampaignGoal {
  return value === 'inquiries' || value === 'signing'
}

export const goalLabel = (goal: CampaignGoal) => GOALS.find((g) => g.key === goal)!.label

/** "מה ההבדל בין האפשרויות?" — one row per thing people ask, one column per goal. */
export const COMPARISON_ROWS: { label: string; inquiries: string; signing: string }[] = [
  { label: 'מה קורה אחרי הטופס', inquiries: 'הפנייה מחכה לצוות (לאשר / להמשיך לחתימה ידנית)', signing: 'הנרשם עובר ישירות להסכם, קוד וחתימה' },
  { label: 'צריך הסכם?', inquiries: 'לא', signing: 'כן (אפשר להעלות אחר כך)' },
  { label: 'קהל קיים', inquiries: 'אפשר, לא חובה', signing: 'אפשר, לא חובה' },
  { label: 'טופס / הטמעה / API / עמוד מותאם', inquiries: 'כן', signing: 'כן' },
  { label: 'הפצות SMS/Email', inquiries: 'כן', signing: 'כן' },
  { label: 'הזמנה אישית', inquiries: 'כן', signing: 'כן' },
  { label: 'דוחות', inquiries: 'פניות, מקורות, נציגים', signing: '+ חתימות, משימות המשך' },
]

/** Who a campaign is for. The `groups.kind` column stores supplier/customer; "both" is null there. */
export type AudienceKind = 'supplier' | 'customer' | 'both'

export const AUDIENCE_KINDS: { key: AudienceKind; label: string }[] = [
  { key: 'supplier', label: 'ספקים' },
  { key: 'customer', label: 'לקוחות' },
  { key: 'both', label: 'שניהם' },
]

export const audienceLabel = (kind: 'supplier' | 'customer' | null) => (kind === 'supplier' ? 'ספקים' : kind === 'customer' ? 'לקוחות' : 'ספקים ולקוחות')

export type EntryMethod = 'audience' | 'form' | 'embed' | 'api' | 'custom'

export const ENTRY_METHODS: { key: EntryMethod; label: string; short: string; blurb: string; goals: CampaignGoal[] }[] = [
  { key: 'audience', label: 'בחירת ספקים/לקוחות קיימים', short: 'קהל קיים', blurb: 'מתוך XTRA Sign, מה-CRM או משניהם. ההסכמים נשלחים אישית לכל נמען.', goals: ['signing'] },
  { key: 'form', label: 'טופס ציבורי של XTRA Sign', short: 'טופס ציבורי', blurb: 'המערכת נותנת כתובת מוכנה לשיתוף.', goals: ['inquiries', 'signing'] },
  { key: 'embed', label: 'הטמעת טופס באתר חיצוני', short: 'הטמעה', blurb: 'קוד הטמעה ל-Wix, Shopify, WordPress, React או כל אתר שתומך בהטמעה.', goals: ['inquiries', 'signing'] },
  { key: 'api', label: 'חיבור דרך API', short: 'API', blurb: 'למי שבונה טופס בעצמו ושולח את הפניות ל-XTRA Sign.', goals: ['inquiries', 'signing'] },
  { key: 'custom', label: 'עמוד נחיתה מותאם שפותח על ידי מפתח', short: 'עמוד מותאם', blurb: 'עמוד ייעודי מחוץ ל-XTRA Sign, מחובר לקמפיין הזה על ידי מפתח.', goals: ['inquiries', 'signing'] },
]

export function isEntryMethod(value: unknown): value is EntryMethod {
  return ENTRY_METHODS.some((m) => m.key === value)
}

export const entryLabel = (entry: EntryMethod) => ENTRY_METHODS.find((m) => m.key === entry)!.short

/** Entries that bring strangers in through a form of some kind. */
export function hasForm(entry: EntryMethod | null | undefined): boolean {
  return entry === 'form' || entry === 'embed' || entry === 'api' || entry === 'custom'
}

/** What happens after a form is filled. */
export type Handling = 'save' | 'auto_sign'
export type AfterRegistration = Handling

export const HANDLING_OPTIONS: { key: Handling; label: string; blurb: string }[] = [
  { key: 'save', label: 'שמירת הפנייה לטיפול', blurb: 'הפרטים יישמרו במערכת והצוות יוכל לבדוק, לאשר ולהמשיך לטיפול.' },
  { key: 'auto_sign', label: 'הרשמה וחתימה אוטומטית', blurb: 'לאחר מילוי הפרטים, המערכת תיצור או תאתר את הספק/הלקוח, תכין את ההסכם ותעביר את הנרשם ישירות לחתימה.' },
]
export const AFTER_REGISTRATION_OPTIONS = HANDLING_OPTIONS

// ── Older shape, still read by older code ─────────────────────────────────

export type CampaignKind = 'public' | 'signature'

export const CAMPAIGN_KINDS: { key: CampaignKind; label: string; badge: string; blurb: string }[] = [
  { key: 'public', label: 'עם טופס', badge: 'טופס', blurb: 'אנשים נכנסים דרך טופס, הטמעה, API או עמוד מותאם.' },
  { key: 'signature', label: 'קהל קיים', badge: 'קהל קיים', blurb: 'ההסכמים נשלחים לאנשים שכבר בחרנו.' },
]

export function isCampaignKind(value: unknown): value is CampaignKind {
  return value === 'public' || value === 'signature'
}

export const kindLabel = (kind: CampaignKind) => CAMPAIGN_KINDS.find((k) => k.key === kind)!.badge

/** The compatibility kind for an entry: anything with a form is "public". */
export function kindForEntry(entry: EntryMethod): CampaignKind {
  return hasForm(entry) ? 'public' : 'signature'
}

/** The goal and entry of a campaign row that may predate the two columns. */
export function describeCampaign(row: { goal?: string | null; entryMethod?: string | null; campaignKind?: string | null; selfServiceEnabled?: boolean; selfServiceSkin?: string | null; landingEnabled?: boolean }): { goal: CampaignGoal; entry: EntryMethod } {
  const goal: CampaignGoal = isCampaignGoal(row.goal) ? row.goal : row.selfServiceEnabled || row.campaignKind === 'signature' ? 'signing' : 'inquiries'
  const entry: EntryMethod = isEntryMethod(row.entryMethod) ? row.entryMethod : row.selfServiceEnabled && row.selfServiceSkin ? 'custom' : row.landingEnabled || row.campaignKind === 'public' ? 'form' : 'audience'
  return { goal, entry }
}

/** How people join a public campaign — the older name for the form-shaped entries. */
export type JoinMethod = 'form' | 'embed' | 'api' | 'custom'

export const JOIN_METHODS: { key: JoinMethod; label: string; blurb: string }[] = ENTRY_METHODS.filter((m) => m.key !== 'audience').map((m) => ({ key: m.key as JoinMethod, label: m.label, blurb: m.blurb }))

// ── Tabs ─────────────────────────────────────────────────────────────────

export type CampaignTab = 'overview' | 'audience' | 'distributions' | 'registrations' | 'agreements' | 'reports' | 'settings'

/** The tabs a campaign shows. "הרשמות" only where a form brings people in. */
export function tabsFor(entry: EntryMethod): CampaignTab[] {
  return hasForm(entry)
    ? ['overview', 'audience', 'distributions', 'registrations', 'agreements', 'reports', 'settings']
    : ['overview', 'audience', 'distributions', 'agreements', 'reports', 'settings']
}

export const TABS_BY_KIND: Record<CampaignKind, CampaignTab[]> = {
  public: tabsFor('form'),
  signature: tabsFor('audience'),
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

/** Registrations are open unless the campaign ended and did not ask to stay open. */
export type CampaignStatus = 'active' | 'paused' | 'ended'

export function isCampaignStatus(value: unknown): value is CampaignStatus {
  return value === 'active' || value === 'paused' || value === 'ended'
}

export const CAMPAIGN_STATUSES: { key: CampaignStatus; label: string; blurb: string }[] = [
  { key: 'active', label: 'פעיל', blurb: 'העמוד פתוח ואפשר להירשם.' },
  { key: 'paused', label: 'מושהה', blurb: 'ההרשמה עצורה זמנית; העמוד מציג הודעה ואפשר לפתוח מחדש בכל רגע.' },
  { key: 'ended', label: 'הסתיים', blurb: 'ההרשמה נסגרה; העמוד מציג את עמוד הסיום. אפשר לפתוח מחדש אם צריך.' },
]

/**
 * Registrations are open when the campaign is active and either has no end
 * date, asked to stay open past it, or has not reached it yet. A paused or
 * ended campaign is closed whatever its dates say.
 */
export function registrationsOpen(campaign: { endsAt: Date | string | null; registrationsAfterEnd: boolean; status?: string | null }, now = new Date()): boolean {
  if (campaign.status && campaign.status !== 'active') return false
  if (!campaign.endsAt) return true
  if (campaign.registrationsAfterEnd) return true
  return new Date(campaign.endsAt).getTime() > now.getTime()
}

/** Why the page is closed, in the words it shows. */
export function closedState(campaign: { endsAt: Date | string | null; registrationsAfterEnd: boolean; status?: string | null }, now = new Date()): 'paused' | 'ended' | null {
  if (registrationsOpen(campaign, now)) return null
  return campaign.status === 'paused' ? 'paused' : 'ended'
}

export const REGISTRATIONS_CLOSED_MESSAGE = 'ההרשמה לקמפיין הסתיימה.'
export const REGISTRATIONS_PAUSED_MESSAGE = 'ההרשמה מושהית זמנית.'
export const DEFAULT_ENDED_TEXT = 'תודה על ההתעניינות. ההרשמה לקמפיין זה הסתיימה ואינה פתוחה עוד להצטרפות.'
export const DEFAULT_PAUSED_TEXT = 'ההרשמה לקמפיין עצורה לזמן קצר. נשמח לראותכם שוב בקרוב.'

/** Where a campaign saves the people who register: here only, or linked to a synced CRM company. */
export type RegistrationTarget = 'xtra_sign' | 'crm'

export function isRegistrationTarget(value: unknown): value is RegistrationTarget {
  return value === 'xtra_sign' || value === 'crm'
}

export const REGISTRATION_TARGETS: { key: RegistrationTarget; label: string; blurb: (noun: string) => string }[] = [
  { key: 'xtra_sign', label: 'XTRA Sign', blurb: (noun) => `ה${noun} שנרשמים יישמרו במערכת בלבד, ללא חיפוש או עדכון ב-CRM.` },
  { key: 'crm', label: 'CRM', blurb: () => 'המערכת תנסה לאתר חברה קיימת בנתוני ה-CRM המסונכרנים (לפי ח.פ.) ותקשר אליה את ההרשמה. מידע ב-CRM לא יעודכן אוטומטית.' },
]
