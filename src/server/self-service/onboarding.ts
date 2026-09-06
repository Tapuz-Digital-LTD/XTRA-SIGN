import { createHash } from 'node:crypto'
import { and, desc, eq, gt, isNull, sql } from 'drizzle-orm'
import { maskPhone, toIsraeliNationalFormat } from '@/lib/phone'
import { validateRegistration, type RegistrationValues } from '@/lib/self-service-registration'
import { skinByKey, type SelfServiceSkin } from '@/lib/self-service-skins'
import type { StaffSession } from '@/server/auth/session'
import { createCompany } from '@/server/companies/companies'
import { getDb, schema } from '@/server/db'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { cancelAgreement } from '@/server/documents/lifecycle'
import { loadFields, saveFields, saveRecipient } from '@/server/documents/save-fields'
import {
  deliverSigningLink,
  issueSigningLink,
  mintAdditionalSigningLink,
} from '@/server/documents/send-agreement'
import { addCompanies } from '@/server/groups/groups'
import { publicBaseUrl } from '@/server/http/public-url'
import { log } from '@/server/log'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'
import { notify } from '@/server/notifications/notifications'
import { findSelfServiceProjectByFormId, type SelfServiceProject } from '@/server/projects/self-service'
import { sendOtp } from '@/server/signing/otp'
import { resolveSigningToken, type SigningContext } from '@/server/signing/session'
import { createDocumentFromTemplate } from '@/server/templates/templates'
import { signedCopyCopy, signingLinkCopy } from './copy'

/**
 * Self-service onboarding: from a stranger's form to a document waiting for
 * their signature, in one call (ADR 0001).
 *
 *   validate → registration row (the idempotency lock) → resolve or create the
 *   supplier → project membership → one open agreement per supplier per
 *   project → fields filled from the form → recipient → signing link →
 *   registration converted → OTP.
 *
 * The messages that carry the link go out AFTER the browser has its answer
 * (`afterResponse`): the person is already on the page and about to type a
 * code; the SMS and email are their way back if they leave.
 *
 * Nothing after the agreement is committed can undo it. A failed message is a
 * recorded delivery and a notification, never a rollback.
 */

export type { RegistrationValues }
export { validateRegistration }

export type RegistrationInput = {
  /** The project's stable public form id. */
  formId: string
  values: Record<string, unknown>
  idempotencyKey: string
  ip: string | null
  referrer: string | null
  meta: Record<string, unknown> | null
}

export type OtpOutcome = { sent: boolean; devCode?: string; message?: string }

export type RegistrationResult =
  | {
      ok: true
      kind: 'ready'
      agreementId: string
      token: string
      signingUrl: string
      maskedPhone: string
      otp: OtpOutcome
      /** Deliveries and notifications — run after the response is sent. */
      afterResponse: () => Promise<void>
    }
  | { ok: true; kind: 'already_signed'; maskedContact: string; afterResponse: () => Promise<void> }
  | { ok: false; message: string; fields?: Record<string, string> }

/** What the registration page asks, as the lead's form snapshot. */
export const REGISTRATION_FIELDS = [
  { id: 'name', label: 'שם העסק / החברה' },
  { id: 'taxId', label: 'ח.פ. / ע.מ.' },
  { id: 'contactName', label: 'שם מלא של מורשה החתימה' },
  { id: 'custom_signatory_role', label: 'תפקיד' },
  { id: 'phone', label: 'טלפון נייד' },
  { id: 'email', label: 'אימייל' },
] as const

const META_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'landing_url', 'form_version'] as const
/** A registration stuck in "pending" this long belongs to a request that died. */
const STALE_PENDING_MS = 60_000
const WAIT_FOR_SIBLING_MS = 6_000

export async function startSelfServiceSigning(input: RegistrationInput): Promise<RegistrationResult> {
  const validated = validateRegistration(input.values)
  if (!validated.ok) return { ok: false, message: 'יש לתקן את הפרטים המסומנים.', fields: validated.fields }
  const data = validated.data

  const project = await findSelfServiceProjectByFormId(input.formId)
  const skin = skinByKey(project?.config.skin)
  if (!project || !skin) return { ok: false, message: 'ההרשמה אינה פעילה כרגע.' }

  const session = systemSession(project, skin)
  const db = getDb()

  // ── The registration row is the lock ─────────────────────────────────────
  const claim = await claimRegistration(project, input, data)
  let registration = claim.row

  if (!claim.fresh) {
    if (registration.status === 'pending') registration = await waitForSibling(registration)

    if (registration.status === 'converted' && registration.agreementId) {
      const replayed = await replay(project, skin, session, registration.agreementId, data)
      if (replayed) return replayed
    }
    if (registration.status === 'pending' && Date.now() - registration.createdAt.getTime() < STALE_PENDING_MS) {
      return { ok: false, message: 'ההרשמה עדיין מעובדת. נסו שוב בעוד רגע.' }
    }
    // Failed, abandoned mid-way, or converted into an agreement that has since
    // died: the same key runs again on the same row.
    await db
      .update(schema.projectLeads)
      .set({ status: 'pending', data: leadData(data), meta: cleanMeta(input.meta), agreementId: null, createdAt: new Date() })
      .where(eq(schema.projectLeads.id, registration.id))
  }

  try {
    // ── Supplier ────────────────────────────────────────────────────────────
    const supplier = await resolveSupplier(session, data)
    await addCompanies({ session, groupId: project.groupId, companyIds: [supplier.id] })

    // ── One open agreement per supplier per project ─────────────────────────
    const existing = await findProjectAgreement(project, supplier.id)
    if (existing?.status === 'signed') {
      await markRegistration(registration.id, { status: 'converted', companyId: supplier.id, agreementId: existing.id })
      return alreadySigned(project, skin, existing.id)
    }
    if (existing && (existing.status === 'sent' || existing.status === 'viewed') && sameDetails(existing.mergeSnapshot, data)) {
      const reissued = await reissue(project, skin, session, existing.id)
      if (reissued) {
        await markRegistration(registration.id, { status: 'converted', companyId: supplier.id, agreementId: existing.id })
        return reissued
      }
    }
    if (existing && existing.status !== 'canceled') {
      // Different details, or a draft a crashed run left behind: the newest
      // submission wins, and the old link stops opening.
      await cancelAgreement({ session, agreementId: existing.id })
    }

    // ── Agreement ───────────────────────────────────────────────────────────
    const created = await createDocumentFromTemplate({
      session,
      templateId: project.template.id,
      companyId: supplier.id,
      ip: input.ip,
    })
    if (!created.ok) throw new Error(created.message)
    const agreementId = created.agreementId

    await fillFromRegistration(session, agreementId, data)

    const recipient = await saveRecipient({
      session,
      agreementId,
      name: data.signatoryName,
      company: data.businessName,
      phone: data.phone,
      email: data.email,
    })
    if (!recipient.ok) throw new Error(recipient.message)

    await db
      .update(schema.agreements)
      .set({
        title: `${project.template.name} — ${data.businessName}`.slice(0, 200),
        mergeSnapshot: {
          selfService: { skin: skin.key, projectId: project.groupId, registrationId: registration.id },
          values: data,
        },
      })
      .where(eq(schema.agreements.id, agreementId))

    const issued = await issueSigningLink({
      session,
      agreementId,
      channels: ['sms', 'email'],
      ttlDays: project.config.linkTtlDays,
    })
    if (!issued.ok) throw new Error(issued.blockers.join(' '))

    // ── The agreement exists and is sendable. Nothing below may lose it. ────
    await markRegistration(registration.id, { status: 'converted', companyId: supplier.id, agreementId })

    const context = await resolveSigningToken(issued.token)
    const otp = context ? await ensureOtp(context) : { sent: false, message: 'לא הצלחנו לשלוח קוד אימות.' }

    return {
      ok: true,
      kind: 'ready',
      agreementId,
      token: issued.token,
      signingUrl: issued.signingUrl,
      maskedPhone: maskPhone(data.phone) ?? '',
      otp,
      afterResponse: async () => {
        await deliverSigningLink({
          agreementId,
          recipient: issued.recipient,
          channels: ['sms', 'email'],
          signingUrl: issued.signingUrl,
          documentTitle: issued.title,
          actor: session.email,
          copy: signingLinkCopy(project, skin),
        }).catch((error) => log.error('self-service link delivery failed', { agreementId, error: String(error) }))

        await notify({
          organizationId: project.organizationId,
          type: 'new_lead',
          agreementId: null,
          link: `/projects/${project.groupId}?tab=leads`,
          title: `הרשמה חדשה בפרויקט ${project.projectName}`,
          body: `${data.businessName} · ${data.signatoryName}`,
          extraEmails: project.notifyEmails,
        })

        if (supplier.nameHint) {
          await notify({
            organizationId: project.organizationId,
            type: 'new_lead',
            agreementId: null,
            link: `/companies/${supplier.nameHint.id}`,
            title: `ייתכן שהספק "${data.businessName}" כבר קיים במערכת`,
            body: `נרשם ספק חדש בשם זהה ל-"${supplier.nameHint.name}", אך בלי ח.פ., טלפון או אימייל תואמים. נוצר ספק נפרד.`,
            extraEmails: project.notifyEmails,
          })
        }
      },
    }
  } catch (error) {
    log.error('self-service registration failed', { registrationId: registration.id, error: String(error) })
    await markRegistration(registration.id, { status: 'failed' }).catch(() => {})
    return { ok: false, message: 'לא הצלחנו להשלים את ההרשמה כרגע. הפרטים נשמרו, אפשר לנסות שוב בעוד רגע.' }
  }
}

// ── Pieces ──────────────────────────────────────────────────────────────────

type RegistrationRow = typeof schema.projectLeads.$inferSelect

/**
 * The staff identity the flow acts as: the project's configured owner, so the
 * agreements are filed and visible like any other; an actor string that says
 * plainly no person did this.
 */
function systemSession(project: SelfServiceProject, skin: SelfServiceSkin): StaffSession {
  return {
    userId: project.owner.id,
    organizationId: project.organizationId,
    email: `self-service:${skin.key}`,
    name: `הרשמה עצמאית — ${project.projectName}`,
    isAdmin: true,
  }
}

function keyHash(groupId: string, key: string): string {
  return createHash('sha256').update(`${groupId}:${key.trim().slice(0, 200)}`).digest('hex')
}

function leadData(data: RegistrationValues) {
  return {
    name: data.businessName,
    taxId: data.taxId,
    contactName: data.signatoryName,
    custom_signatory_role: data.signatoryRole,
    phone: data.phone,
    email: data.email,
  }
}

function cleanMeta(raw: unknown): Record<string, string> | null {
  if (!raw || typeof raw !== 'object') return null
  const out: Record<string, string> = {}
  for (const key of META_KEYS) {
    const value = (raw as Record<string, unknown>)[key]
    if (typeof value === 'string' && value.trim()) out[key] = value.trim().slice(0, 200)
  }
  return Object.keys(out).length > 0 ? out : null
}

async function claimRegistration(
  project: SelfServiceProject,
  input: RegistrationInput,
  data: RegistrationValues,
): Promise<{ row: RegistrationRow; fresh: boolean }> {
  const db = getDb()
  const idempotencyKey = keyHash(project.groupId, input.idempotencyKey)
  const referrer =
    typeof input.referrer === 'string' && /^https?:\/\//i.test(input.referrer) ? input.referrer.slice(0, 300) : null

  const inserted = await db
    .insert(schema.projectLeads)
    .values({
      organizationId: project.organizationId,
      groupId: project.groupId,
      status: 'pending',
      data: leadData(data),
      formSnapshot: REGISTRATION_FIELDS,
      source: 'self_service',
      ip: input.ip,
      referrer,
      idempotencyKey,
      meta: cleanMeta(input.meta),
    })
    .onConflictDoNothing()
    .returning()
  if (inserted[0]) return { row: inserted[0], fresh: true }

  // Someone with the same key got here first: a double click, a retry after
  // a timeout. Their row is the one to follow.
  const [existing] = await db
    .select()
    .from(schema.projectLeads)
    .where(and(eq(schema.projectLeads.groupId, project.groupId), eq(schema.projectLeads.idempotencyKey, idempotencyKey)))
    .limit(1)
  return { row: existing, fresh: false }
}

/** Gives the request that holds the key a few seconds to finish. */
async function waitForSibling(row: RegistrationRow): Promise<RegistrationRow> {
  const db = getDb()
  const deadline = Date.now() + WAIT_FOR_SIBLING_MS
  let current = row
  while (current.status === 'pending' && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400))
    const [fresh] = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, row.id)).limit(1)
    if (!fresh) break
    current = fresh
  }
  return current
}

async function markRegistration(
  id: string,
  patch: { status: 'converted' | 'failed'; companyId?: string; agreementId?: string },
): Promise<void> {
  await getDb()
    .update(schema.projectLeads)
    .set({
      status: patch.status,
      ...(patch.companyId ? { companyId: patch.companyId } : {}),
      ...(patch.agreementId ? { agreementId: patch.agreementId } : {}),
      ...(patch.status === 'converted' ? { reviewedAt: new Date() } : {}),
    })
    .where(eq(schema.projectLeads.id, id))
}

type ResolvedSupplier = { id: string; matchedOn: 'taxId' | 'phone' | 'email' | null; nameHint: { id: string; name: string } | null }

/**
 * The supplier this registration is about.
 *
 * Strongest signal first, each compared after normalisation so a hyphen or a
 * country code cannot split one business into two: tax id by digits, phone by
 * its last nine digits, email case-insensitively. A name alone is never a
 * match — it is reported so a person can look — and the row created is a
 * separate supplier.
 */
async function resolveSupplier(session: StaffSession, data: RegistrationValues): Promise<ResolvedSupplier> {
  const db = getDb()
  const c = schema.companies
  const scope = and(eq(c.organizationId, session.organizationId), eq(c.kind, 'supplier'), isNull(c.deletedAt))
  const national = data.phone.slice(-9)

  const attempts: { on: ResolvedSupplier['matchedOn']; where: ReturnType<typeof sql> }[] = [
    { on: 'taxId', where: sql`regexp_replace(coalesce(${c.taxId}, ''), '\\D', '', 'g') = ${data.taxId}` },
    { on: 'phone', where: sql`right(regexp_replace(coalesce(${c.contactPhone}, ''), '\\D', '', 'g'), 9) = ${national}` },
    { on: 'email', where: sql`lower(coalesce(${c.contactEmail}, '')) = ${data.email}` },
  ]
  for (const attempt of attempts) {
    const [row] = await db.select({ id: c.id }).from(c).where(and(scope, attempt.where)).orderBy(c.createdAt).limit(1)
    if (row) return { id: row.id, matchedOn: attempt.on, nameHint: null }
  }

  const [sameName] = await db
    .select({ id: c.id, name: c.name })
    .from(c)
    .where(and(scope, sql`lower(${c.name}) = lower(${data.businessName})`))
    .limit(1)

  const created = await createCompany({
    session,
    kind: 'supplier',
    data: {
      name: data.businessName,
      taxId: data.taxId,
      contactName: data.signatoryName,
      contactPhone: data.phone,
      contactEmail: data.email,
    },
  })
  if (!created.ok) throw new Error(created.message)
  return { id: created.id, matchedOn: null, nameHint: sameName ?? null }
}

async function findProjectAgreement(project: SelfServiceProject, companyId: string) {
  const [row] = await getDb()
    .select({ id: schema.agreements.id, status: schema.agreements.status, mergeSnapshot: schema.agreements.mergeSnapshot })
    .from(schema.agreements)
    .where(
      and(
        eq(schema.agreements.organizationId, project.organizationId),
        eq(schema.agreements.companyId, companyId),
        sql`${schema.agreements.mergeSnapshot}->'selfService'->>'projectId' = ${project.groupId}`,
      ),
    )
    .orderBy(desc(schema.agreements.createdAt))
    .limit(1)
  return row ?? null
}

function sameDetails(snapshot: unknown, data: RegistrationValues): boolean {
  const values = (snapshot as { values?: Partial<RegistrationValues> } | null)?.values
  if (!values) return false
  return (Object.keys(data) as (keyof RegistrationValues)[]).every((key) => values[key] === data[key])
}

/** The form's answers, in the boxes the PDF named for them. */
async function fillFromRegistration(session: StaffSession, agreementId: string, data: RegistrationValues): Promise<void> {
  const agreement = await authorizeAgreementAccess(session, agreementId)
  if (!agreement.currentVersionId) throw new Error('agreement has no version')

  const national = toIsraeliNationalFormat(data.phone) ?? data.phone
  const values: Record<string, string> = {
    business_name: data.businessName,
    company_number: data.taxId,
    contact_phone: `${national.slice(0, 3)}-${national.slice(3)}`,
    contact_email: data.email,
    authorized_signatory: data.signatoryName,
    signatory_role: data.signatoryRole,
  }

  const fields = await loadFields(agreement.currentVersionId)
  const filled = fields.map((field) =>
    field.variableKey && values[field.variableKey] !== undefined
      ? { ...field, ownedBy: 'sender' as const, value: values[field.variableKey] }
      : field,
  )
  const unmatched = Object.keys(values).filter((key) => !fields.some((f) => f.variableKey === key))
  if (unmatched.length > 0) log.warn('self-service template lacks boxes for', { agreementId, unmatched })

  const saved = await saveFields({ session, agreementId, fields: filled })
  if (!saved.ok) throw new Error(saved.message)
}

/**
 * The OTP for this signer. A code already in flight (a replay a second after
 * the first click) is not re-sent: the one in their inbox is the one that
 * works, and the cooldown would refuse anyway.
 */
async function ensureOtp(context: SigningContext): Promise<OtpOutcome> {
  const [live] = await getDb()
    .select({ id: schema.otpChallenges.id })
    .from(schema.otpChallenges)
    .where(
      and(
        eq(schema.otpChallenges.recipientId, context.recipientId),
        isNull(schema.otpChallenges.consumedAt),
        gt(schema.otpChallenges.expiresAt, new Date()),
      ),
    )
    .limit(1)
  if (live) return { sent: true }

  const result = await sendOtp(context)
  return result.ok ? { sent: true, devCode: result.devCode } : { sent: false, message: result.message }
}

/** The same key again, for an agreement that already exists. */
async function replay(
  project: SelfServiceProject,
  skin: SelfServiceSkin,
  session: StaffSession,
  agreementId: string,
  data: RegistrationValues,
): Promise<RegistrationResult | null> {
  const [agreement] = await getDb()
    .select({ id: schema.agreements.id, status: schema.agreements.status, mergeSnapshot: schema.agreements.mergeSnapshot })
    .from(schema.agreements)
    .where(eq(schema.agreements.id, agreementId))
    .limit(1)
  if (!agreement) return null
  if (agreement.status === 'signed') return alreadySigned(project, skin, agreement.id)
  if ((agreement.status === 'sent' || agreement.status === 'viewed') && sameDetails(agreement.mergeSnapshot, data)) {
    return reissue(project, skin, session, agreement.id)
  }
  return null
}

/** An open agreement, a fresh link, the code — without a second document. */
async function reissue(
  project: SelfServiceProject,
  skin: SelfServiceSkin,
  session: StaffSession,
  agreementId: string,
): Promise<RegistrationResult | null> {
  const db = getDb()
  const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, agreementId)).limit(1)
  if (!recipient) return null
  const [latest] = await db
    .select({ expiresAt: schema.signingTokens.expiresAt })
    .from(schema.signingTokens)
    .where(and(eq(schema.signingTokens.recipientId, recipient.id), isNull(schema.signingTokens.revokedAt)))
    .orderBy(desc(schema.signingTokens.createdAt))
    .limit(1)
  if (!latest || latest.expiresAt.getTime() < Date.now()) return null

  const minted = await mintAdditionalSigningLink(recipient.id, latest.expiresAt)
  const context = await resolveSigningToken(minted.token)
  if (!context) return null
  const otp = await ensureOtp(context)

  return {
    ok: true,
    kind: 'ready',
    agreementId,
    token: minted.token,
    signingUrl: minted.signingUrl,
    maskedPhone: maskPhone(recipient.phone) ?? '',
    otp,
    afterResponse: async () => {
      // A double click is two requests a second apart; the first one's
      // messages are already on their way. Only a genuinely later return
      // (a retry after a timeout, a second attempt tomorrow) gets the link
      // sent again.
      const [recent] = await db
        .select({ id: schema.deliveries.id })
        .from(schema.deliveries)
        .where(and(eq(schema.deliveries.agreementId, agreementId), gt(schema.deliveries.createdAt, new Date(Date.now() - 60_000))))
        .limit(1)
      if (recent) return

      await deliverSigningLink({
        agreementId,
        recipient: { id: recipient.id, name: recipient.name, phone: recipient.phone, email: recipient.email },
        channels: [...(recipient.phone ? (['sms'] as const) : []), ...(recipient.email ? (['email'] as const) : [])],
        signingUrl: minted.signingUrl,
        documentTitle: context.title,
        actor: session.email,
        copy: signingLinkCopy(project, skin),
      }).catch((error) => log.error('self-service link redelivery failed', { agreementId, error: String(error) }))
    },
  }
}

/**
 * The business already signed. The signed copy goes to the contact on file —
 * the phone and email that verified the first time — never to a browser that
 * merely typed a company number.
 */
async function alreadySigned(project: SelfServiceProject, skin: SelfServiceSkin, agreementId: string): Promise<RegistrationResult> {
  const db = getDb()
  const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, agreementId)).limit(1)
  const maskedContact = maskPhone(recipient?.phone) ?? maskEmail(recipient?.email) ?? ''

  return {
    ok: true,
    kind: 'already_signed',
    maskedContact,
    afterResponse: async () => {
      if (!recipient) return
      const expiresAt = new Date(Date.now() + project.config.linkTtlDays * 24 * 60 * 60 * 1000)
      const minted = await mintAdditionalSigningLink(recipient.id, expiresAt)
      const url = `${publicBaseUrl()}/${project.publicSlug}/thanks/${minted.token}`
      const copy = signedCopyCopy(project, skin)
      if (recipient.phone) {
        await new InforuSmsProvider().send({ to: recipient.phone, text: copy.sms(recipient.name, url), recipientName: recipient.name })
      }
      if (recipient.email) {
        await new InforuEmailProvider().send({ to: recipient.email, ...copy.email(recipient.name, url), recipientName: recipient.name })
      }
    },
  }
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [user, domain] = email.split('@')
  if (!domain) return null
  return `${user.slice(0, 2)}***@${domain}`
}
