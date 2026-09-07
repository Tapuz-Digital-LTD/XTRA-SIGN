import { and, desc, eq, isNull } from 'drizzle-orm'
import { AUDIT_EVENTS } from '@/server/audit'
import { ForbiddenError, type StaffSession } from '@/server/auth/session'
import { generateToken, hashToken } from '@/server/auth/tokens'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'
import { cleanOverrides, renderTemplate, resolveMessage, type MessageOverrides } from '@/lib/message-template'
import { brandFor, DEFAULT_BRAND, type EmailBrand } from '@/server/mail/brand'
import { renderEmail } from '@/server/mail/render'
import { InvitationEmail, ReminderEmail } from '@/server/mail/templates'
import { originFromSnapshot } from '@/server/self-service/agreement-skin'
import { signingLinkCopy } from '@/server/self-service/copy'
import { publicBaseUrl } from '@/server/http/public-url'
import { notify } from '@/server/notifications/notifications'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'
import type { NotificationProvider } from '@/server/notifications/types'
import { authorizeAgreementAccess } from './authorization'
import { buildSendSummary, type Channel } from './send-validation'

/**
 * Sends a document for signature.
 *
 * Two halves, deliberately separable: ISSUING the link (token + status
 * change, one transaction) and DELIVERING it (SMS/email, third-party calls
 * that can hang). Order matters: the token is committed before any message
 * goes out. A delivery that fails leaves a live, resendable request; a
 * message that goes out before the token exists would carry a dead link.
 *
 * `sendAgreement` is the two halves back to back — the ordinary send. The
 * self-service flow issues first, answers the browser, and delivers after
 * the response (ADR 0001).
 */

const SIGNING_LINK_TTL_DAYS = 30

export type Delivery = { channel: Channel; sent: boolean; error?: string }

export type SendResult =
  | { ok: true; signingUrl: string; deliveries: Delivery[] }
  | { ok: false; blockers: string[] }

export type IssueResult =
  | {
      ok: true
      token: string
      signingUrl: string
      expiresAt: Date
      recipient: { id: string; name: string; phone: string | null; email: string | null }
      title: string
    }
  | { ok: false; blockers: string[] }

/** The words that carry a signing link. Overridable per campaign. */
/** What the mail knows about who is sending: the name on the footer, the colours on the header. */
export type MailContext = {
  organizationName: string
  brand: EmailBrand
  expiresAt?: Date | null
  /** The campaign behind the agreement, when there is one. */
  groupId?: string | null
  campaignName?: string | null
  /** The campaign's own words, by event; blank fields fall back to the defaults. */
  messages?: MessageOverrides | null
}

export type LinkCopy = {
  sms: (name: string, url: string, ctx?: MailContext) => string
  email: (name: string, title: string, url: string, ctx: MailContext) => Promise<{ subject: string; text: string; html: string }>
}

/** The system's own words for "there is a document waiting for you". */
export const DEFAULT_LINK_COPY: LinkCopy = {
  sms: (name, url, ctx) => renderTemplate(resolveMessage('invitation', ctx?.messages?.invitation).sms!, { signer_name: name, signing_link: url, campaign_name: ctx?.campaignName ?? '', organization_name: ctx?.organizationName ?? '' }).text,
  email: async (name, title, url, ctx) => {
    const t = resolveMessage('invitation', ctx.messages?.invitation).email!
    const vars = { signer_name: name, document_name: title, signing_link: url, organization_name: ctx.organizationName, campaign_name: ctx.campaignName ?? '', expires_at: ctx.expiresAt ? formatDay(ctx.expiresAt) : '' }
    return renderEmail(
      renderTemplate(t.subject, vars).text,
      InvitationEmail({
        brand: ctx.brand,
        title: 'נשלח אליך מסמך לחתימה',
        body: renderTemplate(t.body, vars).text,
        cta: t.cta ?? 'לצפייה וחתימה',
        signingUrl: url,
        facts: [
          { label: 'מסמך', value: title },
          { label: 'נשלח על ידי', value: ctx.organizationName },
          ...(ctx.expiresAt ? [{ label: 'בתוקף עד', value: formatDay(ctx.expiresAt) }] : []),
        ],
        organizationName: ctx.organizationName,
      }),
    )
  },
}

/** "Still waiting for you": the reminder wording, with the fresh link. */
export const REMINDER_LINK_COPY: LinkCopy = {
  sms: (name, url, ctx) => renderTemplate(resolveMessage('reminder', ctx?.messages?.reminder).sms!, { signer_name: name, signing_link: url, campaign_name: ctx?.campaignName ?? '', organization_name: ctx?.organizationName ?? '' }).text,
  email: async (name, title, url, ctx) => {
    const t = resolveMessage('reminder', ctx.messages?.reminder).email!
    const vars = { signer_name: name, document_name: title, signing_link: url, organization_name: ctx.organizationName, campaign_name: ctx.campaignName ?? '', expires_at: ctx.expiresAt ? formatDay(ctx.expiresAt) : '' }
    return renderEmail(
      renderTemplate(t.subject, vars).text,
      ReminderEmail({
        brand: ctx.brand,
        title: 'תזכורת: המסמך עדיין ממתין לחתימתך',
        body: renderTemplate(t.body, vars).text,
        cta: t.cta ?? 'להמשך חתימה',
        signingUrl: url,
        facts: [{ label: 'מסמך', value: title }, { label: 'נשלח על ידי', value: ctx.organizationName }],
        organizationName: ctx.organizationName,
      }),
    )
  },
}

function formatDay(date: Date): string {
  return new Intl.DateTimeFormat('he-IL', { dateStyle: 'medium', timeZone: 'Asia/Jerusalem' }).format(date)
}

/** The organization behind an agreement, and the colours its mail wears. */
export async function mailContextFor(agreementId: string): Promise<MailContext> {
  const [row] = await getDb()
    .select({ organizationId: schema.agreements.organizationId, organizationName: schema.organizations.name, expiresAt: schema.agreements.expiresAt, mergeSnapshot: schema.agreements.mergeSnapshot })
    .from(schema.agreements)
    .innerJoin(schema.organizations, eq(schema.organizations.id, schema.agreements.organizationId))
    .where(eq(schema.agreements.id, agreementId))
    .limit(1)
  const skin = (row?.mergeSnapshot as { selfService?: { skin?: string } } | null)?.selfService?.skin ?? null
  const campaign = await campaignFor(agreementId)
  return {
    organizationName: row?.organizationName ?? 'XTRA Sign',
    brand: row ? await brandFor({ organizationId: row.organizationId, skin }) : DEFAULT_BRAND,
    expiresAt: row?.expiresAt ?? null,
    groupId: campaign?.id ?? null,
    campaignName: campaign?.name ?? null,
    messages: campaign ? cleanOverrides(campaign.messageOverrides) : null,
  }
}

/** The campaign an agreement belongs to — through a bulk send or a registration — or null. */
export async function campaignFor(agreementId: string): Promise<{ id: string; name: string; linkTtlDays: number; messageOverrides: unknown } | null> {
  const db = getDb()
  const cols = { id: schema.groups.id, name: schema.groups.name, linkTtlDays: schema.groups.linkTtlDays, messageOverrides: schema.groups.messageOverrides }
  const [viaBatch] = await db
    .select(cols)
    .from(schema.bulkBatchItems)
    .innerJoin(schema.bulkBatches, eq(schema.bulkBatches.id, schema.bulkBatchItems.batchId))
    .innerJoin(schema.groups, eq(schema.groups.id, schema.bulkBatches.groupId))
    .where(eq(schema.bulkBatchItems.agreementId, agreementId))
    .limit(1)
  if (viaBatch) return viaBatch
  const [viaLead] = await db
    .select(cols)
    .from(schema.projectLeads)
    .innerJoin(schema.groups, eq(schema.groups.id, schema.projectLeads.groupId))
    .where(eq(schema.projectLeads.agreementId, agreementId))
    .limit(1)
  return viaLead ?? null
}

export async function sendAgreement(input: {
  session: StaffSession
  agreementId: string
  channels: Channel[]
}): Promise<SendResult> {
  const issued = await issueSigningLink(input)
  if (!issued.ok) return issued

  const deliveries = await deliverSigningLink({
    agreementId: input.agreementId,
    recipient: issued.recipient,
    channels: input.channels,
    signingUrl: issued.signingUrl,
    documentTitle: issued.title,
    actor: input.session.email,
  })

  return { ok: true, signingUrl: issued.signingUrl, deliveries }
}

/**
 * Mints the signing link and moves the document to "sent", without telling
 * anyone yet. 32 bytes of CSPRNG; only the hash is stored, so a database dump
 * is not a set of working signing links.
 */
export async function issueSigningLink(input: {
  session: StaffSession
  agreementId: string
  channels: Channel[]
  ttlDays?: number
}): Promise<IssueResult> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  if (agreement.status !== 'draft') {
    return { ok: false, blockers: ['המסמך כבר נשלח.'] }
  }

  const summary = await buildSendSummary(agreement.id, agreement.currentVersionId, input.channels, true)
  if (!summary.canSend) return { ok: false, blockers: summary.blockers }

  const db = getDb()

  const [recipient] = await db
    .select()
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreement.id))
    .limit(1)

  if (!recipient) throw new ForbiddenError()

  const token = generateToken()
  const ttlDays = input.ttlDays && input.ttlDays > 0 ? input.ttlDays : await ttlDaysFor(agreement.id)
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)

  await db.transaction(async (tx) => {
    await tx.insert(schema.signingTokens).values({
      recipientId: recipient.id,
      tokenHash: hashToken(token),
      expiresAt,
    })

    await tx
      .update(schema.agreements)
      .set({ status: 'sent', sentAt: new Date(), expiresAt })
      .where(eq(schema.agreements.id, agreement.id))

    await tx.insert(schema.auditEvents).values({
      agreementId: agreement.id,
      recipientId: recipient.id,
      type: AUDIT_EVENTS.SENT,
      actor: input.session.email,
      // Never the token itself.
      metadata: { channels: input.channels },
    })
  })

  return {
    ok: true,
    token,
    signingUrl: buildSigningUrl(token),
    expiresAt,
    recipient: { id: recipient.id, name: recipient.name, phone: recipient.phone, email: recipient.email },
    title: agreement.title,
  }
}

/**
 * A second, equally valid link for the same recipient.
 *
 * The raw token of the first link was never stored, so a flow that needs to
 * hand the same signer a link again — a registration replayed after a double
 * click — mints another one rather than rotating the first, which would kill
 * a link the signer may be holding in the other hand.
 */
export async function mintAdditionalSigningLink(
  recipientId: string,
  expiresAt: Date,
): Promise<{ token: string; signingUrl: string }> {
  const token = generateToken()
  await getDb().insert(schema.signingTokens).values({
    recipientId,
    tokenHash: hashToken(token),
    expiresAt,
  })
  return { token, signingUrl: buildSigningUrl(token) }
}

/** Every channel, each recorded as its own Delivery. */
export async function deliverSigningLink(input: {
  agreementId: string
  recipient: { id: string; name: string; phone: string | null; email: string | null }
  channels: Channel[]
  signingUrl: string
  documentTitle: string
  actor: string
  copy?: LinkCopy
  event?: 'invitation' | 'reminder' | 'registration_completed'
}): Promise<Delivery[]> {
  const deliveries: Delivery[] = []
  for (const channel of input.channels) {
    deliveries.push(
      await deliver({
        event: input.event,
        channel,
        agreementId: input.agreementId,
        recipientId: input.recipient.id,
        recipientName: input.recipient.name,
        to: channel === 'sms' ? (input.recipient.phone ?? '') : (input.recipient.email ?? ''),
        documentTitle: input.documentTitle,
        signingUrl: input.signingUrl,
        actor: input.actor,
        copy: input.copy ?? DEFAULT_LINK_COPY,
      }),
    )
  }
  return deliveries
}

export function buildSigningUrl(token: string): string {
  return `${publicBaseUrl()}/sign/${token}`
}

/**
 * One channel. Records a Delivery either way, so a failure is visible on the
 * document rather than only in a log.
 */
async function deliver(input: {
  channel: Channel
  agreementId: string
  recipientId: string
  recipientName: string
  to: string
  documentTitle: string
  signingUrl: string
  actor: string
  copy: LinkCopy
  /** What this send is, for the snapshot: invitation by default. */
  event?: 'invitation' | 'reminder' | 'registration_completed'
}): Promise<Delivery> {
  const db = getDb()
  const provider: NotificationProvider =
    input.channel === 'sms' ? new InforuSmsProvider() : new InforuEmailProvider()
  const ctx = await mailContextFor(input.agreementId)

  const message =
    input.channel === 'sms'
      ? {
          to: input.to,
          text: input.copy.sms(input.recipientName, input.signingUrl, ctx),
          recipientName: input.recipientName,
        }
      : {
          to: input.to,
          ...(await input.copy.email(input.recipientName, input.documentTitle, input.signingUrl, ctx)),
          recipientName: input.recipientName,
        }

  const result = await provider.send(message)

  // The exact words that left, kept beside the agreement. Never allowed to
  // fail the send: the snapshot is a record, not a step.
  try {
    const [agreement] = await db.select({ organizationId: schema.agreements.organizationId }).from(schema.agreements).where(eq(schema.agreements.id, input.agreementId)).limit(1)
    if (agreement) {
      await db.insert(schema.messageSends).values({
        organizationId: agreement.organizationId,
        groupId: ctx.groupId ?? null,
        agreementId: input.agreementId,
        channel: input.channel,
        event: input.event ?? 'invitation',
        recipient: input.to,
        subject: 'subject' in message ? message.subject : null,
        body: message.text,
        variables: { signer_name: input.recipientName, document_name: input.documentTitle, campaign_name: ctx.campaignName ?? null },
        providerMessageId: result.providerMessageId,
        ok: result.ok,
        error: result.ok ? null : result.error,
      })
    }
  } catch (error) {
    log.warn('message snapshot failed', { agreementId: input.agreementId, error: String(error) })
  }

  await db.insert(schema.deliveries).values({
    agreementId: input.agreementId,
    recipientId: input.recipientId,
    channel: input.channel,
    provider: 'inforu',
    providerMessageId: result.providerMessageId,
    status: result.ok ? 'sent' : 'failed',
    error: result.ok ? null : result.error,
    sentAt: result.ok ? new Date() : null,
    failedAt: result.ok ? null : new Date(),
  })

  await db.insert(schema.auditEvents).values({
    agreementId: input.agreementId,
    recipientId: input.recipientId,
    type: result.ok
      ? input.channel === 'sms'
        ? AUDIT_EVENTS.SMS_SENT
        : AUDIT_EVENTS.EMAIL_SENT
      : input.channel === 'sms'
        ? AUDIT_EVENTS.SMS_FAILED
        : AUDIT_EVENTS.EMAIL_FAILED,
    actor: input.actor,
    metadata: {
      providerMessageId: result.providerMessageId,
      ...(result.ok ? {} : { error: result.error }),
    },
  })

  if (!result.ok) {
    // The operator has to learn about this somewhere other than the audit log:
    // a failed send looks exactly like a signer who has not got round to it.
    const [row] = await db
      .select({ organizationId: schema.agreements.organizationId, title: schema.agreements.title })
      .from(schema.agreements)
      .where(eq(schema.agreements.id, input.agreementId))
      .limit(1)
    if (row) {
      await notify({
        organizationId: row.organizationId,
        type: 'send_failed',
        agreementId: input.agreementId,
        title: `השליחה של "${row.title}" נכשלה`,
        body: input.channel === 'sms' ? 'שליחה ב-SMS' : 'שליחה באימייל',
      })
    }
  }

  return {
    channel: input.channel,
    sent: result.ok,
    error: result.ok ? undefined : result.error,
  }
}

/** Inline styles only: every mail client strips a stylesheet. */

/**
 * How long a signing link lives: the campaign's setting when the agreement
 * belongs to one (through a bulk send or a self-service registration), the
 * system default otherwise.
 */
export async function ttlDaysFor(agreementId: string): Promise<number> {
  const campaign = await campaignFor(agreementId)
  return campaign?.linkTtlDays || SIGNING_LINK_TTL_DAYS
}

/**
 * Gives an expired (or expiring) link new life: a fresh token, a fresh
 * lifetime from the campaign, the agreement back to "sent", the invitation
 * sent again. A deliberate action with its own audit row — reminders and
 * resends never quietly extend anything.
 */
export async function renewSigningLink(input: {
  session: StaffSession
  agreementId: string
  channels: Channel[]
}): Promise<{ ok: boolean; message?: string; expiresAt?: Date }> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  if (!['sent', 'viewed', 'expired'].includes(agreement.status)) return { ok: false, message: 'ניתן לחדש קישור רק למסמך שממתין לחתימה או שפג תוקפו.' }
  const db = getDb()
  const [recipient] = await db.select().from(schema.recipients).where(eq(schema.recipients.agreementId, agreement.id)).limit(1)
  if (!recipient) return { ok: false, message: 'לא נמצא חותם.' }
  const ttlDays = await ttlDaysFor(agreement.id)
  const expiresAt = new Date(Date.now() + ttlDays * 24 * 60 * 60 * 1000)
  const token = generateToken()
  await db.transaction(async (tx) => {
    // A new link next to the old one, never in its place: a message the signer
    // still has must keep opening the same document (its own page renews it).
    await tx.insert(schema.signingTokens).values({ recipientId: recipient.id, tokenHash: hashToken(token), expiresAt })
    await tx.update(schema.agreements).set({ expiresAt, status: agreement.status === 'expired' ? 'sent' : agreement.status }).where(eq(schema.agreements.id, agreement.id))
    await tx.insert(schema.auditEvents).values({ agreementId: agreement.id, recipientId: recipient.id, type: AUDIT_EVENTS.LINK_RENEWED, actor: input.session.email, metadata: { previousStatus: agreement.status, ttlDays, channels: input.channels } })
  })
  if (input.channels.length > 0) {
    await deliverSigningLink({
      agreementId: agreement.id,
      recipient: { id: recipient.id, name: recipient.name, phone: recipient.phone, email: recipient.email },
      channels: input.channels,
      signingUrl: buildSigningUrl(token),
      documentTitle: agreement.title,
      actor: input.session.email,
    })
  }
  return { ok: true, expiresAt }
}

/** Resends the same request on the same link, without creating a new one. */
export async function resendAgreement(input: {
  session: StaffSession
  agreementId: string
  channels: Channel[]
  /** A reminder says "still waiting"; a resend repeats the original invitation. */
  kind?: 'reminder' | 'resend'
}): Promise<{ ok: boolean; message?: string }> {
  const agreement = await authorizeAgreementAccess(input.session, input.agreementId)
  if (!['sent', 'viewed'].includes(agreement.status)) {
    return { ok: false, message: 'ניתן לשלוח תזכורת רק למסמך שממתין לחתימה.' }
  }

  const db = getDb()
  const [recipient] = await db
    .select()
    .from(schema.recipients)
    .where(eq(schema.recipients.agreementId, agreement.id))
    .limit(1)

  if (!recipient) return { ok: false, message: 'לא נמצא חותם.' }

  const [existing] = await db
    .select()
    .from(schema.signingTokens)
    .where(and(eq(schema.signingTokens.recipientId, recipient.id), isNull(schema.signingTokens.revokedAt)))
    .orderBy(desc(schema.signingTokens.expiresAt))
    .limit(1)

  if (!existing) return { ok: false, message: 'לא נמצא קישור חתימה פעיל.' }

  // The raw token was never stored, so the original URL cannot be rebuilt to
  // put in the reminder: a second link is minted next to it with the same
  // lifetime. Every message the signer holds keeps working — an older link is
  // renewed by its own page when it runs out — and the session they may
  // already have is bound to them, not to a link.
  const token = generateToken()
  await db.insert(schema.signingTokens).values({
    recipientId: recipient.id,
    tokenHash: hashToken(token),
    expiresAt: existing.expiresAt.getTime() > Date.now() ? existing.expiresAt : new Date(Date.now() + (await ttlDaysFor(agreement.id)) * 24 * 60 * 60 * 1000),
  })

  const signingUrl = buildSigningUrl(token)

  const kind = input.kind ?? 'reminder'
  // A campaign's agreement keeps the campaign's invitation words on a resend.
  const [snapshotRow] = await db.select({ mergeSnapshot: schema.agreements.mergeSnapshot }).from(schema.agreements).where(eq(schema.agreements.id, agreement.id)).limit(1)
  const origin = originFromSnapshot(snapshotRow?.mergeSnapshot)
  const campaignCopy = origin
    ? signingLinkCopy({ projectName: (await db.select({ name: schema.groups.name }).from(schema.groups).where(eq(schema.groups.id, origin.projectId)).limit(1))[0]?.name ?? agreement.title }, origin.skin)
    : null
  await deliverSigningLink({
    agreementId: agreement.id,
    recipient: { id: recipient.id, name: recipient.name, phone: recipient.phone, email: recipient.email },
    channels: input.channels,
    signingUrl,
    documentTitle: agreement.title,
    actor: input.session.email,
    copy: kind === 'reminder' ? REMINDER_LINK_COPY : (campaignCopy ?? DEFAULT_LINK_COPY),
  })

  await db.insert(schema.auditEvents).values({
    agreementId: agreement.id,
    recipientId: recipient.id,
    type: kind === 'reminder' ? AUDIT_EVENTS.REMINDER_SENT : AUDIT_EVENTS.SENT,
    actor: input.session.email,
    metadata: { channels: input.channels, kind },
  })

  return { ok: true }
}
