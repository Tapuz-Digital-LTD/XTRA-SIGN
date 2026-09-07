import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { normalizeIsraeliPhone, maskPhone } from '@/lib/phone'
import { getDb, schema } from '@/server/db'

/**
 * "דורשים טיפול" — the one place that decides what needs a person, why, and
 * what the button says.
 *
 * Two separate facts never blur into one: the signature (status) and the
 * message (a send that failed). A signed agreement whose copy did not reach
 * the signer stays "נחתם"; the reason on it is about the mail, and the action
 * is about the mail. The SQL in documents/queries.ts filters the tab with the
 * same rules; this module is what the rows then carry.
 */

export type AttentionKey =
  | 'send_failed'
  | 'invalid_email'
  | 'invalid_phone'
  | 'link_expired'
  | 'no_company'
  | 'reminder_due'
  | 'crm_link_needed'

export type AttentionActionKind =
  | 'resend_message'
  | 'fix_email'
  | 'fix_phone'
  | 'renew_link'
  | 'link_company'
  | 'remind'
  | 'open_registration'
  | 'none'

export type AttentionReason = {
  key: AttentionKey
  /** 1 = something broke (red), 2 = waiting on a person (amber), 3 = housekeeping. */
  severity: 1 | 2 | 3
  /** One line, in words: what happened. Never a status, never an error code. */
  title: string
  /** A sentence or two: what happened and what to do about it. */
  explanation: string
  action: { kind: AttentionActionKind; label: string; sendId?: string; channel?: 'sms' | 'email' | 'whatsapp' }
  canActNow: boolean
  handledBy: 'user' | 'system'
  occurredAt: Date | null
}

/**
 * How long a viewed-but-unsigned document waits before it counts as stuck.
 * The same threshold the reminder job uses, so the screen and the reminders
 * cannot disagree about what "waiting too long" means.
 */
export const STALE_AFTER_DAYS = 3

/** A real-looking address: labels without doubled dots, a letters-only top level. */
export const EMAIL_RE = /^[^\s@]+@(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i

/** The events that carry a signing link; a failure there is moot once the request closed. */
const LINK_EVENTS = new Set(['invitation', 'reminder', 'registration_completed'])
const OPEN = new Set(['sent', 'viewed'])

const DAY_MS = 24 * 60 * 60 * 1000

/** "ra…@gmail..com": enough to recognise, not enough to copy. */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const at = email.indexOf('@')
  if (at < 0) return `${email.slice(0, 2)}…`
  return `${email.slice(0, Math.min(2, at))}…${email.slice(at)}`
}

export function maskRecipient(channel: string, to: string): string {
  return channel === 'email' ? (maskEmail(to) ?? '') : (maskPhone(to) ?? `${to.slice(0, 4)}…`)
}

/** What the provider said, read for the one thing a person can fix: a bad address. */
function looksInvalid(channel: string, to: string, error: string | null): boolean {
  if (channel === 'sms') return !normalizeIsraeliPhone(to) || /invalid_phone|invalid number|invalid phone/i.test(error ?? '')
  return !EMAIL_RE.test(to) || /invalid|mailing list|not valid|bad address|no valid recipient/i.test(error ?? '')
}

function channelWord(channel: string): string {
  return channel === 'sms' ? 'ב-SMS' : 'במייל'
}

function failedTitle(event: string, channel: string): string {
  if (event === 'signed_confirmation') return 'ההסכם נחתם, אך המייל עם העותק החתום לא נשלח לחותם'
  if (event === 'reminder') return `התזכורת לא נשלחה ${channelWord(channel)}`
  return `קישור החתימה לא נשלח ${channelWord(channel)}`
}

function failedReason(input: {
  sendId: string | null
  event: string
  channel: string
  to: string | null
  error: string | null
  occurredAt: Date
  /** Legacy audit-only failure: no snapshot, so nothing to resend as-is. */
  legacy?: boolean
  open: boolean
}): AttentionReason {
  if (input.channel === 'whatsapp') {
    // A share from the rep's own phone. Only what the rep reported as not sent is a failure.
    return {
      key: 'send_failed',
      severity: 1,
      title: 'ההודעה ב-WhatsApp לא נשלחה',
      explanation: 'הנציג דיווח שההודעה לא נשלחה מהטלפון. אפשר לפתוח את השיתוף שוב ולשלוח.',
      action: { kind: 'resend_message', label: 'שלח שוב ב-WhatsApp', sendId: input.sendId ?? undefined, channel: 'whatsapp' },
      canActNow: true,
      handledBy: 'user',
      occurredAt: input.occurredAt,
    }
  }
  const ch = input.channel === 'sms' ? 'sms' : 'email'
  const title = failedTitle(input.event, ch)
  if (input.legacy) {
    return {
      key: 'send_failed',
      severity: 1,
      title,
      explanation: 'ניסיון השליחה נכשל.',
      action: input.open ? { kind: 'remind', label: 'שלח תזכורת', channel: ch } : { kind: 'none', label: '' },
      canActNow: input.open,
      handledBy: 'user',
      occurredAt: input.occurredAt,
    }
  }
  const masked = input.to ? maskRecipient(ch, input.to) : ''
  if (input.to && looksInvalid(ch, input.to, input.error)) {
    return ch === 'sms'
      ? {
          key: 'invalid_phone',
          severity: 1,
          title,
          explanation: `המספר שהוזן (${masked}) אינו תקין, ולכן ההודעה לא יכלה להגיע. תקנו את המספר ושלחו שוב.`,
          action: { kind: 'fix_phone', label: 'תקן מספר טלפון ושלח שוב', sendId: input.sendId!, channel: ch },
          canActNow: true,
          handledBy: 'user',
          occurredAt: input.occurredAt,
        }
      : {
          key: 'invalid_email',
          severity: 1,
          title,
          explanation: `הכתובת שהוזנה (${masked}) אינה תקינה, ולכן המייל לא יכול היה להגיע. תקנו את הכתובת ושלחו שוב.`,
          action: { kind: 'fix_email', label: 'תקן כתובת מייל ושלח שוב', sendId: input.sendId!, channel: ch },
          canActNow: true,
          handledBy: 'user',
          occurredAt: input.occurredAt,
        }
  }
  return {
    key: 'send_failed',
    severity: 1,
    title,
    explanation: `ניסיון השליחה אל ${masked} נכשל. אפשר לשלוח את אותה הודעה שוב.`,
    action: { kind: 'resend_message', label: ch === 'sms' ? 'שלח את ה-SMS שוב' : 'שלח את המייל שוב', sendId: input.sendId!, channel: ch },
    canActNow: true,
    handledBy: 'user',
    occurredAt: input.occurredAt,
  }
}

/**
 * Every reason for every agreement asked about, batched: three queries for
 * the whole page, not three per row. Sorted worst-first, then newest-first.
 */
export async function attentionForAgreements(
  organizationId: string,
  agreementIds: string[],
  now: Date = new Date(),
): Promise<Map<string, AttentionReason[]>> {
  const out = new Map<string, AttentionReason[]>()
  if (agreementIds.length === 0) return out
  const db = getDb()

  const [agreements, sends, audits] = await Promise.all([
    db
      .select({ id: schema.agreements.id, status: schema.agreements.status, companyId: schema.agreements.companyId, expiresAt: schema.agreements.expiresAt, sentAt: schema.agreements.sentAt })
      .from(schema.agreements)
      .where(and(eq(schema.agreements.organizationId, organizationId), inArray(schema.agreements.id, agreementIds))),
    db
      .select({ id: schema.messageSends.id, agreementId: schema.messageSends.agreementId, channel: schema.messageSends.channel, event: schema.messageSends.event, recipient: schema.messageSends.recipient, ok: schema.messageSends.ok, error: schema.messageSends.error, sentAt: schema.messageSends.sentAt, resolvedAt: schema.messageSends.resolvedAt, manualState: schema.messageSends.manualState })
      .from(schema.messageSends)
      .where(and(eq(schema.messageSends.organizationId, organizationId), inArray(schema.messageSends.agreementId, agreementIds), eq(schema.messageSends.isTest, false)))
      .orderBy(asc(schema.messageSends.sentAt)),
    db
      .select({ agreementId: schema.auditEvents.agreementId, type: schema.auditEvents.type, createdAt: schema.auditEvents.createdAt })
      .from(schema.auditEvents)
      .where(and(inArray(schema.auditEvents.agreementId, agreementIds), inArray(schema.auditEvents.type, ['email_failed', 'sms_failed', 'email_sent', 'sms_sent', 'reminder_sent'])))
      .orderBy(asc(schema.auditEvents.createdAt)),
  ])

  const stale = new Date(now.getTime() - STALE_AFTER_DAYS * DAY_MS)

  for (const a of agreements) {
    const reasons: AttentionReason[] = []
    const open = OPEN.has(a.status)
    const mine = sends.filter((s) => s.agreementId === a.id)
    const myAudits = audits.filter((e) => e.agreementId === a.id)

    // (a) A send that failed, nobody handled, and no later send of the same
    // message on the same channel succeeded. A canceled agreement has nothing
    // left to send; a link that failed to go out no longer matters once the
    // request is closed.
    if (a.status !== 'canceled') {
      for (const s of mine) {
        if (s.ok || s.resolvedAt) continue
        // WhatsApp: 'opened' (or nothing yet) is not a failure — only what the rep reported as not sent.
        if (s.channel === 'whatsapp' && s.manualState !== 'not_sent') continue
        if (LINK_EVENTS.has(s.event) && !open) continue
        const superseded = mine.some((later) => later.ok && later.event === s.event && later.channel === s.channel && later.sentAt > s.sentAt)
        if (superseded) continue
        reasons.push(failedReason({ sendId: s.id, event: s.event, channel: s.channel, to: s.recipient, error: s.error, occurredAt: s.sentAt, open }))
      }
    }

    // (b) Before message snapshots existed, a failure was only an audit row.
    // Counts while the request is still open and nothing on that channel
    // went out afterwards; a reminder is the way to send it again.
    if (mine.length === 0 && open) {
      for (const e of myAudits) {
        if (e.type !== 'email_failed' && e.type !== 'sms_failed') continue
        const channel = e.type === 'sms_failed' ? 'sms' : 'email'
        const sentLater = myAudits.some((later) => later.type === `${channel}_sent` && later.createdAt > e.createdAt)
        if (sentLater) continue
        reasons.push(failedReason({ sendId: null, event: 'invitation', channel, to: null, error: null, occurredAt: e.createdAt, legacy: true, open }))
      }
    }

    // (c) The signing link ran out while the document was still open.
    if (open && a.expiresAt && a.expiresAt < now) {
      reasons.push({
        key: 'link_expired',
        severity: 2,
        title: 'קישור החתימה פג',
        explanation: 'החותם כבר לא יכול לפתוח את הקישור שנשלח. חידוש הקישור שולח לו קישור חדש עם תוקף חדש.',
        action: { kind: 'renew_link', label: 'חדש קישור ושלח שוב' },
        canActNow: true,
        handledBy: 'user',
        occurredAt: a.expiresAt,
      })
    }

    // (e) Opened, then nothing — for at least as long as a reminder waits,
    // and no reminder went out in that window.
    if (a.status === 'viewed' && a.sentAt && a.sentAt < stale && !(a.expiresAt && a.expiresAt < now)) {
      const remindedRecently = myAudits.some((e) => e.type === 'reminder_sent' && e.createdAt > stale)
      if (!remindedRecently) {
        const days = Math.floor((now.getTime() - a.sentAt.getTime()) / DAY_MS)
        reasons.push({
          key: 'reminder_due',
          severity: 2,
          title: `נצפה ולא נחתם כבר ${days} ימים`,
          explanation: 'החותם פתח את המסמך אבל לא חתם. תזכורת קצרה בדרך כלל מספיקה.',
          action: { kind: 'remind', label: 'שלח תזכורת' },
          canActNow: true,
          handledBy: 'user',
          occurredAt: a.sentAt,
        })
      }
    }

    // (d) Filed under nobody, so it is only ever findable in this list.
    if (!a.companyId) {
      reasons.push({
        key: 'no_company',
        severity: 3,
        title: 'ההסכם לא משויך לספק או ללקוח',
        explanation: 'בלי שיוך ההסכם לא יופיע בדף של החברה ולא יעלה ל-CRM.',
        action: { kind: 'link_company', label: 'שיוך לספק/לקוח' },
        canActNow: true,
        handledBy: 'user',
        occurredAt: null,
      })
    }

    if (reasons.length) out.set(a.id, sortReasons(reasons))
  }
  return out
}

export function sortReasons(reasons: AttentionReason[]): AttentionReason[] {
  return [...reasons].sort((x, y) => x.severity - y.severity || (y.occurredAt?.getTime() ?? 0) - (x.occurredAt?.getTime() ?? 0))
}

export function topReason(reasons: AttentionReason[] | undefined): AttentionReason | null {
  return reasons?.[0] ?? null
}

/** (f) A registration whose company still has to be matched in the CRM. Wired by the registrations table. */
export function registrationAttention(lead: { meta: unknown }): AttentionReason | null {
  const meta = (lead.meta && typeof lead.meta === 'object' ? lead.meta : {}) as { linking?: unknown }
  if (meta.linking !== 'needed') return null
  return {
    key: 'crm_link_needed',
    severity: 2,
    title: 'ההרשמה לא שויכה לחברה ב-CRM',
    explanation: 'המערכת לא הצליחה להתאים את ההרשמה לחברה קיימת. בדקו את השיוך ואשרו אותו.',
    action: { kind: 'open_registration', label: 'בדוק שיוך' },
    canActNow: true,
    handledBy: 'user',
    occurredAt: null,
  }
}

export type AttentionAttempt = {
  id: string
  sentAt: Date
  channel: string
  event: string
  /** Masked: enough to recognise, not enough to copy. */
  to: string
  ok: boolean
  error: string | null
  retryOf: string | null
  resolvedAt: Date | null
  resolvedNote: string | null
  /** WhatsApp only: what the rep reported. Never read as delivery. */
  manualState: string | null
}

/** The drawer: every reason, and every attempt that was made, newest first. */
export async function attentionDetail(organizationId: string, agreementId: string): Promise<{ reasons: AttentionReason[]; attempts: AttentionAttempt[] }> {
  const reasons = (await attentionForAgreements(organizationId, [agreementId])).get(agreementId) ?? []
  const rows = await getDb()
    .select({
      id: schema.messageSends.id,
      sentAt: schema.messageSends.sentAt,
      channel: schema.messageSends.channel,
      event: schema.messageSends.event,
      recipient: schema.messageSends.recipient,
      ok: schema.messageSends.ok,
      error: schema.messageSends.error,
      retryOf: schema.messageSends.retryOf,
      resolvedAt: schema.messageSends.resolvedAt,
      resolvedNote: schema.messageSends.resolvedNote,
      manualState: schema.messageSends.manualState,
    })
    .from(schema.messageSends)
    .where(and(eq(schema.messageSends.organizationId, organizationId), eq(schema.messageSends.agreementId, agreementId), eq(schema.messageSends.isTest, false)))
    .orderBy(desc(schema.messageSends.sentAt))
    .limit(50)
  return { reasons, attempts: rows.map(({ recipient, ...r }) => ({ ...r, to: maskRecipient(r.channel, recipient) })) }
}
