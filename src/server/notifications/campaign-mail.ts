import { classifySource, type Utm } from '@/lib/campaign-events'
import { DEFAULT_MESSAGES, renderTemplate, resolveMessage, type MessageTemplate, type Variables } from '@/lib/message-template'
import { publicBaseUrl } from '@/server/http/public-url'
import type { EmailBrand } from '@/server/mail/brand'
import { renderEmail, type RenderedEmail } from '@/server/mail/render'
import { NewRegistrationEmail, SignedConfirmationEmail, SignedTeamEmail } from '@/server/mail/templates'

export { brandFor } from '@/server/mail/brand'
export type { RenderedEmail } from '@/server/mail/render'

/**
 * The emails a campaign sends about its own people: to the team when
 * someone registers or signs, and to the signer when their signature is
 * done. The signer's one goes through the message templates, so a
 * campaign can reword it; all of them go through the shared React Email
 * layout.
 */

const when = new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Jerusalem' })

// ── what the form asked, in the order it asked ────────────────────────────

export type SubmissionField = { label: string; value: string }

/**
 * A submission as rows, following the form as it was when the person filled
 * it. Fields the snapshot does not know (an older form, a system value)
 * come after, with the best label available — nothing typed is dropped.
 */
export function renderSubmission(data: unknown, snapshot: unknown): SubmissionField[] {
  const values = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
  const fields = Array.isArray(snapshot) ? (snapshot as { id?: unknown; label?: unknown }[]) : []
  const rows: SubmissionField[] = []
  const seen = new Set<string>()
  const show = (v: unknown): string =>
    Array.isArray(v) ? v.map(show).filter(Boolean).join(', ') : typeof v === 'boolean' ? (v ? 'כן' : 'לא') : v === null || v === undefined ? '' : String(v)
  for (const f of fields) {
    if (typeof f.id !== 'string') continue
    seen.add(f.id)
    const value = show(values[f.id])
    if (value.trim()) rows.push({ label: typeof f.label === 'string' && f.label ? f.label : f.id, value })
  }
  for (const [key, v] of Object.entries(values)) {
    if (seen.has(key)) continue
    const value = show(v)
    if (value.trim()) rows.push({ label: KNOWN_LABELS[key] ?? key.replace(/^custom_/, '').replaceAll('_', ' '), value })
  }
  return rows
}

const KNOWN_LABELS: Record<string, string> = {
  name: 'שם העסק / החברה',
  businessName: 'שם העסק / החברה',
  taxId: 'ח.פ. / ע.מ.',
  contactName: 'איש קשר / מורשה חתימה',
  signatoryName: 'מורשה חתימה',
  signatoryRole: 'תפקיד',
  custom_signatory_role: 'תפקיד',
  phone: 'טלפון',
  email: 'אימייל',
  address: 'כתובת',
  notes: 'הערות',
}

const ltrIf = (value: string) => (/^[\d+\-\s()@.a-z_]+$/i.test(value) ? ('ltr' as const) : undefined)

// ── the team's emails ─────────────────────────────────────────────────────

export async function registrationEmail(input: {
  projectId: string
  projectName: string
  registeredAt: Date
  fields: SubmissionField[]
  utm?: Utm | null
  referrer?: string | null
  /** Where "צפייה בליד במערכת" goes: the supplier, or the leads tab. */
  link: string
  brand?: EmailBrand | null
}): Promise<RenderedEmail> {
  const source = classifySource(input.utm, input.referrer)
  const facts = [
    { label: 'קמפיין', value: input.projectName },
    { label: 'תאריך ושעת הרשמה', value: when.format(input.registeredAt) },
    ...input.fields.map((f) => ({ label: f.label, value: f.value, dir: ltrIf(f.value) })),
    { label: 'מקור ההגעה', value: source.medium ? `${source.label} / ${source.medium}` : source.label },
    ...(input.utm?.utm_source ? [{ label: 'UTM source', value: input.utm.utm_source, dir: 'ltr' as const }] : []),
    ...(input.utm?.utm_medium ? [{ label: 'UTM medium', value: input.utm.utm_medium, dir: 'ltr' as const }] : []),
    ...(input.utm?.utm_campaign ? [{ label: 'UTM campaign', value: input.utm.utm_campaign, dir: 'ltr' as const }] : []),
  ]
  const business = input.fields[0]?.value ?? ''
  const subject = `ספק חדש נרשם – ${input.projectName}`
  const body = business ? `${business} השלים/ה הרשמה בקמפיין.` : 'התקבלה הרשמה חדשה בקמפיין.'
  return renderEmail(subject, NewRegistrationEmail({ brand: input.brand, title: subject, body, facts, openUrl: `${publicBaseUrl()}${input.link}` }))
}

export async function signedTeamEmail(input: {
  projectName: string | null
  documentName: string
  agreementId: string
  companyId: string | null
  companyName: string | null
  taxId: string | null
  signerName: string
  signedAt: Date
  brand?: EmailBrand | null
}): Promise<RenderedEmail> {
  const base = publicBaseUrl()
  const subject = `הסכם נחתם – ${input.companyName ?? input.signerName}`
  const facts = [
    ...(input.projectName ? [{ label: 'קמפיין', value: input.projectName }] : []),
    ...(input.companyName ? [{ label: 'שם העסק', value: input.companyName }] : []),
    ...(input.taxId ? [{ label: 'ח.פ.', value: input.taxId, dir: 'ltr' as const }] : []),
    { label: 'מסמך', value: input.documentName },
    { label: 'שם החותם', value: input.signerName },
    { label: 'תאריך ושעת חתימה', value: when.format(input.signedAt) },
    { label: 'סטטוס', value: 'נחתם' },
  ]
  const links = [
    { label: 'הורדת ההסכם החתום', href: `${base}/api/documents/${input.agreementId}/download` },
    ...(input.companyId ? [{ label: 'פתח את הספק', href: `${base}/companies/${input.companyId}` }] : []),
  ]
  return renderEmail(
    subject,
    SignedTeamEmail({ brand: input.brand, title: subject, body: `"${input.documentName}" נחתם.`, facts, viewUrl: `${base}/documents/${input.agreementId}`, links }),
  )
}

// ── the signer's confirmation ─────────────────────────────────────────────

/**
 * "Your signature is done": generic words, the campaign's colours when it
 * has them, and a button that fetches the signed copy through a link scoped
 * to this one document. Rendered from the message template, so a campaign
 * can reword it; the download link always resolves.
 */
export async function signerConfirmationEmail(input: {
  vars: Variables & { document_name: string; signer_name: string; signed_document_link: string; organization_name: string; signed_at: string }
  template?: Partial<MessageTemplate> | null
  brand?: EmailBrand | null
  note?: string | null
}): Promise<RenderedEmail & { missing: string[] }> {
  const message = resolveMessage('signed_confirmation', input.template)
  const email = message.email ?? DEFAULT_MESSAGES.signed_confirmation.email!
  const subject = renderTemplate(email.subject, input.vars)
  const body = renderTemplate(email.body, input.vars)
  const cta = renderTemplate(email.cta ?? 'הורדת המסמך החתום', input.vars).text || 'הורדת המסמך החתום'
  const rendered = await renderEmail(
    subject.text,
    SignedConfirmationEmail({
      brand: input.brand,
      title: 'החתימה הושלמה בהצלחה',
      body: body.text,
      cta,
      downloadUrl: input.vars.signed_document_link,
      facts: [
        { label: 'מסמך', value: input.vars.document_name },
        { label: 'חותם', value: input.vars.signer_name },
        { label: 'תאריך חתימה', value: input.vars.signed_at },
      ],
      note: input.note,
      organizationName: input.vars.organization_name,
    }),
  )
  return { ...rendered, missing: [...new Set([...subject.missing, ...body.missing])] }
}
