/**
 * Message templates: text with `{{variables}}`, nothing more.
 *
 * A template is data. A variable is a name from an allow-list that the
 * sender resolves server-side; there is no expression language, no code,
 * no lookup a template can invent. `{{first_name | "לקוח/ה"}}` is the whole
 * syntax: a key, and an optional literal fallback. Values are escaped for
 * the context they land in — HTML in an email body, nothing in an SMS —
 * so a name typed by a stranger cannot become markup.
 *
 * Three layers resolve a message: the system default here, a campaign's
 * override, and a distribution's own copy. Every layer is the same shape.
 */

export type VariableKey =
  | 'signer_name'
  | 'first_name'
  | 'last_name'
  | 'phone'
  | 'email'
  | 'company_name'
  | 'company_number'
  | 'contact_name'
  | 'campaign_name'
  | 'campaign_url'
  | 'campaign_start'
  | 'campaign_end'
  | 'document_name'
  | 'signing_link'
  | 'expires_at'
  | 'signed_document_link'
  | 'signed_at'
  | 'organization_name'
  | 'organization_phone'
  | 'organization_email'
  | 'organization_website'
  | 'distribution_name'

export type VariableGroup = 'recipient' | 'company' | 'campaign' | 'document' | 'organization' | 'distribution'

/** What the picker shows: Hebrew names, grouped the way a person thinks. */
export const VARIABLE_CATALOG: { key: VariableKey; label: string; group: VariableGroup; link?: boolean }[] = [
  { key: 'signer_name', label: 'שם החותם', group: 'recipient' },
  { key: 'first_name', label: 'שם פרטי', group: 'recipient' },
  { key: 'last_name', label: 'שם משפחה', group: 'recipient' },
  { key: 'phone', label: 'טלפון', group: 'recipient' },
  { key: 'email', label: 'אימייל', group: 'recipient' },
  { key: 'company_name', label: 'שם החברה', group: 'company' },
  { key: 'company_number', label: 'ח.פ.', group: 'company' },
  { key: 'contact_name', label: 'איש קשר', group: 'company' },
  { key: 'campaign_name', label: 'שם הקמפיין', group: 'campaign' },
  { key: 'campaign_url', label: 'כתובת העמוד הציבורי', group: 'campaign', link: true },
  { key: 'campaign_start', label: 'תאריך התחלה', group: 'campaign' },
  { key: 'campaign_end', label: 'תאריך סיום', group: 'campaign' },
  { key: 'document_name', label: 'שם המסמך', group: 'document' },
  { key: 'signing_link', label: 'קישור לחתימה', group: 'document', link: true },
  { key: 'expires_at', label: 'תאריך תפוגה', group: 'document' },
  { key: 'signed_document_link', label: 'קישור למסמך החתום', group: 'document', link: true },
  { key: 'signed_at', label: 'תאריך החתימה', group: 'document' },
  { key: 'organization_name', label: 'שם הארגון', group: 'organization' },
  { key: 'organization_phone', label: 'טלפון הארגון', group: 'organization' },
  { key: 'organization_email', label: 'אימייל הארגון', group: 'organization' },
  { key: 'organization_website', label: 'אתר הארגון', group: 'organization' },
  { key: 'distribution_name', label: 'שם ההפצה', group: 'distribution' },
]

export const GROUP_LABELS: Record<VariableGroup, string> = {
  recipient: 'נמען',
  company: 'חברה',
  campaign: 'קמפיין',
  document: 'מסמך',
  organization: 'ארגון',
  distribution: 'הפצה',
}

/** Links must always resolve: an empty fallback for one is a broken message. */
export const LINK_VARIABLES = new Set<string>(VARIABLE_CATALOG.filter((v) => v.link).map((v) => v.key))

export type MessageEvent = 'invitation' | 'reminder' | 'signed_confirmation' | 'registration_completed'

/** The events a campaign may reword, by its kind; OTP is not among them on purpose. */
export const EVENTS_BY_KIND: Record<'public' | 'signature', MessageEvent[]> = {
  public: ['registration_completed', 'invitation', 'reminder', 'signed_confirmation'],
  signature: ['invitation', 'reminder', 'signed_confirmation'],
}

export const EVENT_LABELS: Record<MessageEvent, { label: string; blurb: string; channels: ('sms' | 'email')[] }> = {
  invitation: { label: 'הזמנה לחתימה', blurb: 'נשלחת עם קישור החתימה כשמסמך יוצא לחותם.', channels: ['sms', 'email'] },
  reminder: { label: 'תזכורת לחתימה', blurb: 'נשלחת ידנית או אוטומטית למי שעוד לא חתם, עם קישור חדש.', channels: ['sms', 'email'] },
  signed_confirmation: { label: 'לאחר חתימה', blurb: 'אישור לחותם עם כפתור מאובטח להורדת המסמך החתום.', channels: ['email'] },
  registration_completed: { label: 'הרשמה הושלמה', blurb: 'למי שנרשם דרך העמוד הציבורי, עם הקישור לחתימה.', channels: ['sms', 'email'] },
}

/** A campaign's overrides: event → the fields it changed. Blank fields fall back to the default. */
export type MessageOverrides = Partial<Record<MessageEvent, Partial<MessageTemplate>>>

export function cleanOverrides(raw: unknown): MessageOverrides {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const out: MessageOverrides = {}
  for (const event of Object.keys(DEFAULT_MESSAGES) as MessageEvent[]) {
    const o = r[event]
    if (!o || typeof o !== 'object') continue
    const t = o as { sms?: unknown; email?: { subject?: unknown; body?: unknown; cta?: unknown } }
    const sms = typeof t.sms === 'string' ? t.sms.trim().slice(0, 1000) : undefined
    const email = t.email && typeof t.email === 'object'
      ? {
          subject: typeof t.email.subject === 'string' ? t.email.subject.trim().slice(0, 200) : '',
          body: typeof t.email.body === 'string' ? t.email.body.trim().slice(0, 5000) : '',
          cta: typeof t.email.cta === 'string' ? t.email.cta.trim().slice(0, 60) : '',
        }
      : undefined
    const hasEmail = email && (email.subject || email.body || email.cta)
    if (sms || hasEmail) out[event] = { ...(sms ? { sms } : {}), ...(hasEmail ? { email } : {}) }
  }
  return out
}

/** Sample values for previews — obviously samples, so a test is never mistaken for the real thing. */
export const SAMPLE_VARIABLES: Variables = {
  signer_name: 'ישראל ישראלי',
  first_name: 'ישראל',
  last_name: 'ישראלי',
  phone: '052-1234567',
  email: 'israel@example.co.il',
  company_name: 'מלון הדוגמה בע"מ',
  company_number: '515123456',
  contact_name: 'ישראל ישראלי',
  campaign_name: 'הקמפיין שלכם',
  campaign_url: 'https://example.invalid/campaign',
  campaign_start: '01/11/2026',
  campaign_end: '30/11/2026',
  document_name: 'הסכם השתתפות (דוגמה)',
  signing_link: 'https://example.invalid/sign/sample',
  expires_at: '06/10/2026',
  signed_document_link: 'https://example.invalid/api/sign/sample/download',
  signed_at: '06/09/2026',
  organization_name: 'הארגון שלכם',
  organization_phone: '03-1234567',
  organization_email: 'office@example.co.il',
  organization_website: 'https://example.co.il',
  distribution_name: 'הפצה ראשונה',
}

export type MessageTemplate = {
  sms?: string
  email?: { subject: string; body: string; cta?: string }
}

/**
 * The words XTRA Sign uses unless a campaign says otherwise. Good enough
 * that most campaigns never open the messages screen.
 */
export const DEFAULT_MESSAGES: Record<MessageEvent, MessageTemplate> = {
  invitation: {
    sms: 'שלום {{signer_name}}, נשלח אליך המסמך "{{document_name}}" לחתימה. לצפייה וחתימה: {{signing_link}}',
    email: {
      subject: 'מסמך לחתימה – {{document_name}}',
      body: 'שלום {{signer_name}},\n\nנשלח אליך מסמך לחתימה מטעם {{organization_name}}.\nלצפייה וחתימה על "{{document_name}}" לחצו על הכפתור.',
      cta: 'לצפייה וחתימה',
    },
  },
  reminder: {
    sms: 'שלום {{signer_name}}, תזכורת: המסמך "{{document_name}}" עדיין ממתין לחתימתך. לחתימה: {{signing_link}}',
    email: {
      subject: 'תזכורת: המסמך "{{document_name}}" ממתין לחתימתך',
      body: 'שלום {{signer_name}},\n\nהמסמך "{{document_name}}" מטעם {{organization_name}} עדיין ממתין לחתימתך.',
      cta: 'לחתימה על המסמך',
    },
  },
  signed_confirmation: {
    email: {
      subject: 'המסמך נחתם בהצלחה – {{document_name}}',
      body: 'שלום {{signer_name}},\n\nתודה. תהליך החתימה על "{{document_name}}" הושלם בהצלחה.\nעותק חתום של המסמך נשמר וזמין עבורך להורדה.',
      cta: 'הורדת המסמך החתום',
    },
  },
  registration_completed: {
    sms: 'שלום {{signer_name}}, תודה שנרשמתם ל{{campaign_name}}. לחתימה על ההסכם: {{signing_link}}',
    email: {
      subject: 'הסכם לחתימה – {{campaign_name}}',
      body: 'שלום {{signer_name}},\n\nתודה על הרשמתכם ל{{campaign_name}}.\nלהשלמת ההצטרפות יש לצפות ולחתום על ההסכם.',
      cta: 'לצפייה וחתימה',
    },
  },
}

export type Variables = Partial<Record<VariableKey | `field_${string}`, string | null | undefined>>

const TOKEN = /\{\{\s*([a-z_][a-z0-9_]*)\s*(?:\|\s*"([^"]*)")?\s*\}\}/g

export type RenderResult = {
  text: string
  /** Variables the template asked for that had no value and no fallback. */
  missing: string[]
  /** Names the template used that are not in the allow-list. */
  unknown: string[]
}

/**
 * Fills a template. `escape` is the context's escaping — HTML for an email
 * body, identity for SMS and subjects. A missing value with a fallback uses
 * the fallback; without one it is reported and rendered as nothing, never
 * as the raw `{{token}}`.
 */
export function renderTemplate(template: string, vars: Variables, escape: (value: string) => string = (v) => v): RenderResult {
  const missing = new Set<string>()
  const unknown = new Set<string>()
  const text = template.replace(TOKEN, (_m, key: string, fallback?: string) => {
    if (!isKnownVariable(key, vars)) {
      unknown.add(key)
      return ''
    }
    const value = vars[key as VariableKey]
    if (value !== null && value !== undefined && String(value).trim() !== '') return escape(String(value))
    if (fallback !== undefined && !LINK_VARIABLES.has(key)) return escape(fallback)
    missing.add(key)
    return ''
  })
  return { text, missing: [...missing], unknown: [...unknown] }
}

export function isKnownVariable(key: string, vars: Variables = {}): boolean {
  if (VARIABLE_CATALOG.some((v) => v.key === key)) return true
  // A form's custom fields travel as field_<id>, only when the context has them.
  return key.startsWith('field_') && key in vars
}

/** The variables a template refers to — for validation before a send. */
export function variablesIn(template: string): { key: string; fallback: string | null }[] {
  const out: { key: string; fallback: string | null }[] = []
  for (const m of template.matchAll(TOKEN)) out.push({ key: m[1], fallback: m[2] ?? null })
  return out
}

export function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;')
}

/** A stored override with blanks falls back field by field to the default. */
export function resolveMessage(event: MessageEvent, override?: Partial<MessageTemplate> | null): MessageTemplate {
  const base = DEFAULT_MESSAGES[event]
  if (!override) return base
  return {
    sms: override.sms?.trim() || base.sms,
    email: base.email
      ? {
          subject: override.email?.subject?.trim() || base.email.subject,
          body: override.email?.body?.trim() || base.email.body,
          cta: override.email?.cta?.trim() || base.email.cta,
        }
      : undefined,
  }
}
