import { createHash } from 'node:crypto'
import { and, desc, eq, gt, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm'
import { maskPhone, normalizeIsraeliPhone, toIsraeliNationalFormat } from '@/lib/phone'
import { TOURISM_WEEKS, validateRegistration, type RegistrationValues } from '@/lib/self-service-registration'
import { skinByKey, type SelfServiceSkin } from '@/lib/self-service-skins'
import type { RegistrationTarget } from '@/lib/campaigns'
import type { PlacedField } from '@/lib/fields'
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
import { attributionFor, linkVisitToRegistration, recordCampaignEvent } from '@/server/analytics/campaign-events'
import { referrerHost, utmFrom } from '@/lib/campaign-events'
import { REGISTRATIONS_CLOSED_MESSAGE } from '@/lib/campaigns'
import { brandFor, registrationEmail, renderSubmission } from '@/server/notifications/campaign-mail'
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
  /** The browser's opaque visit id, for the campaign funnel. */
  visitId?: string | null
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
  { id: 'taxId', label: 'מספר ח.פ.' },
  { id: 'commercialName', label: 'שם העסק המסחרי' },
  { id: 'email', label: 'דוא״ל' },
  { id: 'contactPerson', label: 'איש קשר' },
  { id: 'phone', label: 'מס׳ טלפון' },
  { id: 'benefit1', label: 'סוג ההטבה 1' },
  { id: 'benefit2', label: 'סוג ההטבה 2' },
  { id: 'benefit3', label: 'סוג ההטבה 3' },
  { id: 'benefitNotes', label: 'הערות - טקסט חופשי' },
  { id: 'redemption', label: 'קוד קופון / מימוש' },
  { id: 'couponCode', label: 'מספר קופון' },
  { id: 'week', label: 'שבוע התיירות האזורי' },
  { id: 'optionalExtension', label: 'הרחבה אופציונלית' },
  { id: 'declareLicense', label: 'רישיון עסק תקף כחוק' },
  { id: 'declareInsurance', label: 'פוליסת ביטוח בתוקף' },
  { id: 'contactName', label: 'שם מלא של המורשה/ת לחתום' },
  { id: 'custom_signatory_role', label: 'תפקיד' },
] as const

const META_KEYS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'landing_url', 'form_version', 'xs_inv'] as const
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
  if (!project.registrationsOpen) return { ok: false, message: REGISTRATIONS_CLOSED_MESSAGE }

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
    const supplier = await resolveSupplier(session, data, project.registrationTarget)
    await addCompanies({ session, groupId: project.groupId, companyIds: [supplier.id] })
    if (supplier.needsLinking) {
      // Saved safely on a local row; the registrations screen shows it as needing a CRM link.
      await db.update(schema.projectLeads).set({ meta: sql`coalesce(${schema.projectLeads.meta}, '{}'::jsonb) || '{"linking":"needed"}'::jsonb` }).where(eq(schema.projectLeads.id, registration.id))
    }

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
    // First and last identified touch, kept apart from the form answers so
    // the reports can say where a signature came from without guessing.
    const attribution = await attributionFor(project.groupId, input.visitId, { invitationId: cleanMeta(input.meta)?.xs_inv ?? null, utm: utmFrom((input.meta ?? {}) as Record<string, string | undefined>) })
    if (attribution.first || attribution.last) {
      await db.update(schema.projectLeads).set({ meta: sql`coalesce(${schema.projectLeads.meta}, '{}'::jsonb) || ${JSON.stringify({ attribution })}::jsonb` }).where(eq(schema.projectLeads.id, registration.id))
    }
    if (input.visitId) {
      await recordCampaignEvent({
        organizationId: project.organizationId,
        groupId: project.groupId,
        type: 'registration_completed',
        visitId: input.visitId,
        canonicalSlug: project.publicSlug,
        utm: utmFrom((input.meta ?? {}) as Record<string, string | undefined>),
        referrer: referrerHost(input.referrer),
        registrationId: registration.id,
        agreementId,
      })
      await linkVisitToRegistration(project.groupId, input.visitId, registration.id, agreementId)
    }

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
        // The signer is on the page right now, typing the code. The "come
        // back and sign" message is for the one who leaves: it goes out only
        // if the agreement is still unsigned a few minutes from now (the
        // daily run catches anything this misses).
        await deferredSigningLink({ agreementId, recipient: issued.recipient, signingUrl: issued.signingUrl, title: issued.title, actor: session.email, project, skin })

        const mail = await registrationEmail({
          projectId: project.groupId,
          projectName: project.projectName,
          registeredAt: registration.createdAt,
          fields: renderSubmission(registration.data, registration.formSnapshot),
          utm: utmFrom((registration.meta ?? {}) as Record<string, string | undefined>),
          referrer: registration.referrer,
          link: `/companies/${supplier.id}`,
          brand: await brandFor({ organizationId: project.organizationId, skin: skin.key }),
        })
        await notify({
          organizationId: project.organizationId,
          type: 'new_lead',
          agreementId: null,
          link: `/companies/${supplier.id}`,
          title: `הרשמה חדשה בפרויקט ${project.projectName}`,
          body: `${data.businessName} · ${data.signatoryName}`,
          extraEmails: project.notifyEmails,
          projectId: project.groupId,
          email: mail,
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
    contactPerson: data.contactPerson,
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


/**
 * The personal invitation this submission belongs to, if there is one.
 *
 * The id on the link is the answer whenever it survives the journey. When it
 * does not, one unambiguous match on the contact details the invitation was
 * addressed to is accepted instead — one row, in this campaign, actually
 * invited by a person. Two candidates is not a match: better a new row than
 * the wrong person's invitation.
 */
async function findInvitation(groupId: string, invitationId: string | null, phone: string | null, email: string | null): Promise<RegistrationRow | null> {
  const db = getDb()
  if (invitationId) {
    const [byId] = await db
      .select()
      .from(schema.projectLeads)
      .where(and(eq(schema.projectLeads.id, invitationId), eq(schema.projectLeads.groupId, groupId)))
      .limit(1)
    if (byId) return byId
  }
  if (!phone && !email) return null
  const contact = [...(phone ? [eq(schema.projectLeads.phone, phone)] : []), ...(email ? [eq(schema.projectLeads.email, email)] : [])]
  const candidates = await db
    .select()
    .from(schema.projectLeads)
    .where(and(eq(schema.projectLeads.groupId, groupId), isNotNull(schema.projectLeads.invitedBy), or(...contact)))
    .limit(2)
  return candidates.length === 1 ? candidates[0] : null
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

  const meta = cleanMeta(input.meta)

  const phone = data.phone ? (normalizeIsraeliPhone(data.phone) ?? null) : null
  const email = data.email?.toLowerCase() ?? null

  /*
   * Came through a personal invitation: that row is this registration. One
   * person, one row, from the invitation to the signature.
   *
   * The invitation is found by the id its link carries, and — because links
   * already in the world may not carry one, and because a person can arrive
   * from a search instead of the message — by the contact details the
   * invitation was addressed to. That is what `phone` and `email` are on this
   * table for. Never by name: two hotels share one.
   *
   * Anything but `converted` may be claimed, not only `invited`: a row that a
   * crashed attempt left `pending`, or one marked `failed`, is still this
   * person's invitation, and refusing it is what forked the process into two
   * rows and left the invitation reading "הוזמן" after they had signed.
   */
  const invitationId = meta?.xs_inv && /^[0-9a-f-]{36}$/i.test(meta.xs_inv) ? meta.xs_inv : null
  const invitation = await findInvitation(project.groupId, invitationId, phone, email)
  if (invitation) {
    // Already a document: this is a repeat submission, not a second person.
    // Their own row goes back to the caller, which replays it.
    if (invitation.status === 'converted' && invitation.agreementId) return { row: invitation, fresh: false }
    const [claimed] = await db
      .update(schema.projectLeads)
      .set({
        status: 'pending',
        data: leadData(data),
        formSnapshot: REGISTRATION_FIELDS,
        // The source stays what it was. It records how this person was
        // recruited — a personal invitation — not what they did afterwards,
        // which the form snapshot and the agreement already say.
        ip: input.ip,
        referrer,
        idempotencyKey,
        meta: { ...(meta ?? {}), xs_inv: invitation.id },
        phone,
        email,
        lastActivityAt: new Date(),
        createdAt: new Date(),
      })
      .where(and(eq(schema.projectLeads.id, invitation.id), ne(schema.projectLeads.status, 'converted')))
      .returning()
    if (claimed) return { row: claimed, fresh: true }
    // It converted under us between the two statements: follow that row.
    const [raced] = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, invitation.id)).limit(1)
    if (raced) return { row: raced, fresh: false }
  }

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
      meta,
      phone,
      email,
      lastActivityAt: new Date(),
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

export type ResolvedSupplier = { id: string; matchedOn: 'taxId' | 'phone' | 'email' | null; nameHint: { id: string; name: string } | null; /** CRM mode found no single company by tax id: the registration sits on a local row and a person should link it. */ needsLinking?: boolean }

/**
 * The supplier this registration is about.
 *
 * Strongest signal first, each compared after normalisation so a hyphen or a
 * country code cannot split one business into two: tax id by digits, phone by
 * its last nine digits, email case-insensitively. A name alone is never a
 * match — it is reported so a person can look — and the row created is a
 * separate supplier.
 */
export async function resolveSupplier(session: StaffSession, data: RegistrationValues, target: RegistrationTarget = 'xtra_sign'): Promise<ResolvedSupplier> {
  const db = getDb()
  const c = schema.companies
  const national = data.phone.slice(-9)
  const taxIdMatch = sql`regexp_replace(coalesce(${c.taxId}, ''), '\\D', '', 'g') = ${data.taxId}`

  if (target === 'crm') {
    // CRM: only the synced mirror, only by the one reliable identifier. One
    // match links; none or several is a question for a person, not a guess.
    const mirror = and(eq(c.organizationId, session.organizationId), eq(c.kind, 'supplier'), isNull(c.deletedAt), isNotNull(c.crmRecordId))
    const matches = await db.select({ id: c.id }).from(c).where(and(mirror, taxIdMatch)).orderBy(c.createdAt).limit(2)
    if (matches.length === 1) return { id: matches[0].id, matchedOn: 'taxId', nameHint: null }
    const local = await resolveLocal(session, data)
    return { ...local, needsLinking: true }
  }
  return resolveLocal(session, data)
}

/**
 * XTRA Sign only: the company is looked for among the rows made here — never
 * among the CRM mirror — strongest signal first, each normalised so a hyphen
 * or a country code cannot split one business into two. A name alone is
 * never a match; it is reported so a person can look.
 */
async function resolveLocal(session: StaffSession, data: RegistrationValues): Promise<ResolvedSupplier> {
  const db = getDb()
  const c = schema.companies
  const scope = and(eq(c.organizationId, session.organizationId), eq(c.kind, 'supplier'), isNull(c.deletedAt), isNull(c.crmRecordId))
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
      contactName: data.contactPerson,
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

/**
 * Where the ticks go, as fractions of the page (origin top-left), so they land
 * in the same place whatever size the page is rendered at. Measured on the
 * approved artwork, 595×842pt.
 *
 * The four weeks are printed as cards with no box of their own: the tick sits
 * in the empty strip under each card's regions line. The coupon pair and the
 * extension do have printed boxes — these are those boxes' own rectangles.
 */
const WEEK_MARK_PAGE = 2
type MarkBox = { x: number; y: number; w: number; h: number; page: number }
const box = (page: number, xPt: number, yTopPt: number, wPt = 14, hPt = 14): MarkBox => ({ page, x: xPt / 595, y: yTopPt / 842, w: wPt / 595, h: hPt / 842 })
const WEEK_MARKS: Record<string, MarkBox> = {
  week_1: box(WEEK_MARK_PAGE, 310, 205),
  week_2: box(WEEK_MARK_PAGE, 55, 205),
  week_3: box(WEEK_MARK_PAGE, 310, 262),
  week_4: box(WEEK_MARK_PAGE, 55, 262),
}
/** redemption_method's two radio widgets, page 1 (pdf y 233..244 and 203..214, bottom origin). */
const REDEMPTION_MARKS: Record<string, MarkBox> = {
  generic_xtra25: box(1, 539, 842 - 244, 11, 11),
  business_pos_code: box(1, 539, 842 - 214, 11, 11),
}
/** optional_extension's checkbox widget, page 2 (pdf y 535..546). */
const EXTENSION_MARK: MarkBox = box(2, 541, 842 - 546, 11, 11)

function mark(id: string, label: string, page: number, at: MarkBox): PlacedField {
  return {
    id,
    type: 'checkbox',
    label,
    ownedBy: 'sender',
    required: false,
    page,
    x: at.x,
    y: at.y,
    width: at.w,
    height: at.h,
    value: 'true',
    options: null,
    placeholder: null,
    autoFill: false,
    autoSource: null,
    variableKey: null,
  }
}

async function fillFromRegistration(session: StaffSession, agreementId: string, data: RegistrationValues): Promise<void> {
  const agreement = await authorizeAgreementAccess(session, agreementId)
  if (!agreement.currentVersionId) throw new Error('agreement has no version')

  const national = toIsraeliNationalFormat(data.phone) ?? data.phone
  const week = TOURISM_WEEKS.find((w) => w.id === data.week)
  const values: Record<string, string> = {
    business_name: data.businessName,
    company_number: data.taxId,
    commercial_business_name: data.commercialName,
    // The document has one box for both; the form asks for them apart.
    contact_phone: `${data.contactPerson}, ${national.slice(0, 3)}-${national.slice(3)}`,
    contact_email: data.email,
    benefit_type_1: data.benefit1,
    benefit_type_2: data.benefit2,
    benefit_type_3: data.benefit3,
    benefit_notes: data.benefitNotes,
    business_coupon_code: data.couponCode,
    authorized_signatory: data.signatoryName,
    signatory_role: data.signatoryRole,
  }

  const fields = await loadFields(agreement.currentVersionId)
  const filled = fields.map((field) =>
    field.variableKey && values[field.variableKey] !== undefined
      ? // The intake marks every box as ours and required. What the form was
        // allowed to leave empty (a trading name, a second benefit line, the
        // notes, a coupon number on the generic path) the document permits
        // empty too — validateRegistration is the gate for what must be there,
        // and an empty optional box must not stop the file from being sent.
        { ...field, ownedBy: 'sender' as const, value: values[field.variableKey], required: values[field.variableKey].trim().length > 0 }
      : field,
  )
  const unmatched = Object.keys(values).filter((key) => !fields.some((f) => f.variableKey === key))
  if (unmatched.length > 0) log.warn('self-service template lacks boxes for', { agreementId, unmatched })

  /*
   * The chosen week has no box of its own in the document — the four are
   * printed as cards, not as fields — so the mark is placed on the card the
   * business chose. Fractions of the page, measured off the artwork, so it
   * lands in the same empty corner whatever size the page is rendered at.
   *
   * Only on a document that has that page: a campaign still on a one-page
   * edition keeps working, and simply carries no week mark.
   */
  const [version] = await getDb()
    .select({ pages: schema.agreementVersions.pageCount })
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, agreement.currentVersionId))
    .limit(1)
  const pages = version?.pages ?? 1
  const marks: PlacedField[] = []
  if (week && pages >= WEEK_MARK_PAGE) marks.push(mark(`week-${week.id}`, 'שבוע התיירות האזורי', WEEK_MARK_PAGE, WEEK_MARKS[week.id]))
  // The coupon choice and the extension are printed as a radio pair and a
  // checkbox. The intake keeps them as drawn and never makes fields of them
  // (a box drawn in a document is a statement, not a question), so the
  // chosen one is ticked here, over its own printed box.
  const coupon = REDEMPTION_MARKS[data.redemption]
  if (coupon && pages >= coupon.page) marks.push(mark(`redemption-${data.redemption}`, 'קוד קופון / מימוש', coupon.page, coupon))
  if (data.optionalExtension && pages >= EXTENSION_MARK.page) marks.push(mark('optional-extension', 'הרחבה אופציונלית', EXTENSION_MARK.page, EXTENSION_MARK))
  const marked = [...filled, ...marks]

  const saved = await saveFields({ session, agreementId, fields: marked })
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
        event: 'registration_completed',
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
        const brand = await brandFor({ organizationId: project.organizationId, skin: skin.key })
        await new InforuEmailProvider().send({ to: recipient.email, ...(await copy.email(recipient.name, url, { organizationName: project.projectName, brand })), recipientName: recipient.name })
      }
    },
  }
}

/** How long a registrant gets to finish on the page before we write to them. */
const LINK_AFTER_MS = Number(process.env.SIGN_SELF_SERVICE_LINK_AFTER_MS ?? (process.env.NODE_ENV === 'test' ? 0 : 4 * 60 * 1000))

async function deferredSigningLink(input: {
  agreementId: string
  recipient: { id: string; name: string; phone: string | null; email: string | null }
  signingUrl: string
  title: string
  actor: string
  project: SelfServiceProject
  skin: SelfServiceSkin
}) {
  try {
    await new Promise((r) => setTimeout(r, LINK_AFTER_MS))
    const [row] = await getDb().select({ status: schema.agreements.status }).from(schema.agreements).where(eq(schema.agreements.id, input.agreementId)).limit(1)
    if (!row || !['sent', 'viewed'].includes(row.status)) return
    await deliverSigningLink({
      agreementId: input.agreementId,
      recipient: input.recipient,
      channels: [...(input.recipient.phone ? (['sms'] as const) : []), ...(input.recipient.email ? (['email'] as const) : [])],
      signingUrl: input.signingUrl,
      documentTitle: input.title,
      actor: input.actor,
      copy: signingLinkCopy(input.project, input.skin),
      event: 'registration_completed',
    })
  } catch (error) {
    log.error('self-service link delivery failed', { agreementId: input.agreementId, error: String(error) })
  }
}

/**
 * The daily safety net for the deferred link above: registrations whose
 * agreement is still unsigned hours later and never received the
 * "come back and sign" message (a function that was cut short, a deploy in
 * between). One message per registration, ever.
 */
export async function sendLinksToAbandonedRegistrations(olderThanMs = 4 * 60 * 60 * 1000): Promise<number> {
  const db = getDb()
  const rows = await db
    .select({
      agreementId: schema.agreements.id,
      title: schema.agreements.title,
      groupName: schema.groups.name,
      groupId: schema.groups.id,
      linkTtlDays: schema.groups.linkTtlDays,
      recipientId: schema.recipients.id,
      name: schema.recipients.name,
      phone: schema.recipients.phone,
      email: schema.recipients.email,
      snapshot: schema.agreements.mergeSnapshot,
    })
    .from(schema.projectLeads)
    .innerJoin(schema.agreements, eq(schema.agreements.id, schema.projectLeads.agreementId))
    .innerJoin(schema.groups, eq(schema.groups.id, schema.projectLeads.groupId))
    .innerJoin(schema.recipients, eq(schema.recipients.agreementId, schema.agreements.id))
    .where(
      and(
        inArray(schema.agreements.status, ['sent', 'viewed']),
        lt(schema.agreements.createdAt, new Date(Date.now() - olderThanMs)),
        sql`not exists (select 1 from ${schema.messageSends} ms where ms.agreement_id = ${schema.agreements.id} and ms.event = 'registration_completed')`,
      ),
    )
    .limit(200)
  let sent = 0
  for (const row of rows) {
    const skinKey = (row.snapshot as { selfService?: { skin?: string } } | null)?.selfService?.skin ?? null
    const skin = skinByKey(skinKey)
    if (!skin) continue
    try {
      const minted = await mintAdditionalSigningLink(row.recipientId, new Date(Date.now() + row.linkTtlDays * 24 * 60 * 60 * 1000))
      await deliverSigningLink({
        agreementId: row.agreementId,
        recipient: { id: row.recipientId, name: row.name, phone: row.phone, email: row.email },
        channels: [...(row.phone ? (['sms'] as const) : []), ...(row.email ? (['email'] as const) : [])],
        signingUrl: minted.signingUrl,
        documentTitle: row.title,
        actor: 'system',
        copy: signingLinkCopy({ projectName: row.groupName }, skin),
        event: 'registration_completed',
      })
      sent++
    } catch (error) {
      log.error('abandoned registration link failed', { agreementId: row.agreementId, error: String(error) })
    }
  }
  return sent
}

function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null
  const [user, domain] = email.split('@')
  if (!domain) return null
  return `${user.slice(0, 2)}***@${domain}`
}
