import { and, between, eq, inArray, isNotNull, isNull, lt, sql } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { notificationConfigOf } from '@/server/projects/notification-settings'
import { brandFor, type EmailBrand } from '@/server/mail/brand'
import { renderEmail } from '@/server/mail/render'
import { AttentionEmail, ReminderEmail, type AttentionRow } from '@/server/mail/templates'
import { DEFAULT_MESSAGES, renderTemplate } from '@/lib/message-template'
import { AUDIT_EVENTS } from '@/server/audit'
import { getDb, schema } from '@/server/db'
import { log } from '@/server/log'
import { getNotificationPrefs, notify, publicUrl } from '@/server/notifications/notifications'
import { InforuEmailProvider, InforuSmsProvider } from '@/server/notifications/inforu'

/**
 * The daily reminder for documents still waiting to be signed.
 *
 * Invoked by Vercel Cron. There is no scheduler to run, no queue and no worker —
 * one route, one schedule line in vercel.json.
 */
export const dynamic = 'force-dynamic'

/** Nothing is chased before this, and nothing is chased forever. */
const FIRST_REMINDER_AFTER_DAYS = 3
const REMINDER_EVERY_DAYS = 3
const MAX_REMINDERS = 3

export async function GET(request: Request) {
  // Vercel signs scheduled invocations with this. Without the check the route
  // is a public button that sends messages to real people.
  const secret = process.env.CRON_SECRET
  const provided = request.headers.get('authorization')
  if (!secret || provided !== `Bearer ${secret}`) {
    return NextResponse.json({ error: { message: 'Unauthorized' } }, { status: 401 })
  }

  const db = getDb()
  const cutoff = new Date(Date.now() - FIRST_REMINDER_AFTER_DAYS * 24 * 60 * 60 * 1000)

  const pending = await db
    .select({
      agreementId: schema.agreements.id,
      organizationId: schema.agreements.organizationId,
      title: schema.agreements.title,
      sentAt: schema.agreements.sentAt,
      recipientId: schema.recipients.id,
      name: schema.recipients.name,
      phone: schema.recipients.phone,
      email: schema.recipients.email,
    })
    .from(schema.agreements)
    .innerJoin(schema.recipients, eq(schema.recipients.agreementId, schema.agreements.id))
    .where(
      and(
        inArray(schema.agreements.status, ['sent', 'viewed']),
        lt(schema.agreements.sentAt, cutoff),
        isNull(schema.recipients.signedAt),
      ),
    )
    .limit(200)

  let sent = 0

  for (const row of pending) {
    // Counted from the trail rather than a column: the audit log is the record
    // of what was actually sent, so it cannot drift from a counter.
    const reminders = await db
      .select({ createdAt: schema.auditEvents.createdAt })
      .from(schema.auditEvents)
      .where(
        and(
          eq(schema.auditEvents.agreementId, row.agreementId),
          eq(schema.auditEvents.type, AUDIT_EVENTS.REMINDER_SENT),
        ),
      )

    if (reminders.length >= MAX_REMINDERS) continue

    const last = reminders
      .map((r) => r.createdAt.getTime())
      .sort((a, b) => b - a)[0]

    if (last && Date.now() - last < REMINDER_EVERY_DAYS * 24 * 60 * 60 * 1000) continue

    // A reminder deliberately carries no signing link: the raw token was never
    // stored, only its hash. It points the signer back at the message they
    // already have, which is also why it cannot become a way to mint links.
    const text = renderTemplate(DEFAULT_MESSAGES.reminder.sms!, { signer_name: row.name, document_name: row.title, signing_link: 'הקישור נשלח אליך קודם לכן' }).text
    const reminderMail = row.email
      ? await renderEmail(
          renderTemplate(DEFAULT_MESSAGES.reminder.email!.subject, { document_name: row.title }).text,
          ReminderEmail({
            brand: await brandFor({ organizationId: row.organizationId }),
            title: 'תזכורת: המסמך עדיין ממתין לחתימתך',
            body: renderTemplate(DEFAULT_MESSAGES.reminder.email!.body, { signer_name: row.name, document_name: row.title, organization_name: 'XTRA Sign' }).text,
            cta: 'להמשך חתימה',
            signingUrl: null,
            facts: [{ label: 'מסמך', value: row.title }],
          }),
        )
      : null

    const results = await Promise.all([
      row.email && reminderMail
        ? new InforuEmailProvider().send({
            to: row.email,
            ...reminderMail,
            recipientName: row.name,
          })
        : null,
      row.phone
        ? new InforuSmsProvider().send({ to: row.phone, text, recipientName: row.name })
        : null,
    ])

    const delivered = results.some((r) => r?.ok)

    await db.insert(schema.auditEvents).values({
      agreementId: row.agreementId,
      recipientId: row.recipientId,
      type: AUDIT_EVENTS.REMINDER_SENT,
      actor: 'system',
      metadata: { delivered, attempt: reminders.length + 1 },
    })

    if (delivered) sent++
  }

  // Links that ran out since the last run. The status is left alone — the
  // expiry is already enforced when the link is opened — but nobody was being
  // told, so an agreement could quietly go nowhere.
  const lapsed = await db
    .select({
      id: schema.agreements.id,
      organizationId: schema.agreements.organizationId,
      title: schema.agreements.title,
    })
    .from(schema.agreements)
    .where(
      and(
        inArray(schema.agreements.status, ['sent', 'viewed']),
        isNotNull(schema.agreements.expiresAt),
        lt(schema.agreements.expiresAt, new Date()),
      ),
    )
    .limit(200)

  for (const row of lapsed) {
    // Idempotent by (organization, type, document), so a daily run does not
    // repeat the same notice every morning.
    await notify({
      organizationId: row.organizationId,
      type: 'expired',
      agreementId: row.id,
      title: `פג תוקף קישור החתימה של "${row.title}"`,
      body: 'ניתן ליצור גרסה חדשה ולשלוח שוב.',
    })
  }

  const digests = await sendDailyDigests()

  log.info('reminder run complete', { candidates: pending.length, sent, lapsed: lapsed.length, digests })
  return NextResponse.json({ ok: true, candidates: pending.length, sent, lapsed: lapsed.length, digests })
}

/**
 * One morning email per organization: what is still waiting, and what is about
 * to lapse. A digest rather than one mail per document — this is the news that
 * ages well, and twenty separate emails about twenty waiting documents is how
 * notifications get turned off.
 */
async function sendDailyDigests(): Promise<number> {
  const db = getDb()
  const now = Date.now()
  const staleCutoff = new Date(now - FIRST_REMINDER_AFTER_DAYS * 24 * 60 * 60 * 1000)
  const soon = new Date(now + 7 * 24 * 60 * 60 * 1000)

  const organizations = await db.select({ id: schema.organizations.id }).from(schema.organizations)

  let digests = 0
  for (const org of organizations) {
    const prefs = await getNotificationPrefs(org.id)
    if (prefs.emails.length === 0) continue
    const wantUnsigned = prefs.events['unsigned_digest'] !== false
    const wantExpiring = prefs.events['expiring_digest'] !== false
    if (!wantUnsigned && !wantExpiring) continue

    const [unsigned, expiring] = await Promise.all([
      wantUnsigned ? attentionRows(and(eq(schema.agreements.organizationId, org.id), lt(schema.agreements.sentAt, staleCutoff))) : [],
      wantExpiring ? attentionRows(and(eq(schema.agreements.organizationId, org.id), isNotNull(schema.agreements.expiresAt), between(schema.agreements.expiresAt, new Date(now), soon))) : [],
    ])

    if (unsigned.length === 0 && expiring.length === 0) continue

    const rendered = await attentionMail(await brandFor({ organizationId: org.id }), null, unsigned, expiring, publicUrl('/agreements?filter=pending'))
    const email = new InforuEmailProvider()
    await Promise.allSettled(prefs.emails.map((to) => email.send({ to, ...rendered })))
    digests++
  }
  return digests + (await sendProjectDigests(staleCutoff, soon))
}

/**
 * A project's addresses get a digest about the project's agreements alone,
 * when the project's settings ask for it. The organization's addresses
 * already had theirs above.
 */
async function sendProjectDigests(staleCutoff: Date, soon: Date): Promise<number> {
  const db = getDb()
  const projects = await db
    .select({ id: schema.groups.id, name: schema.groups.name, organizationId: schema.groups.organizationId, notifyEmails: schema.groups.notifyEmails, notificationConfig: schema.groups.notificationConfig })
    .from(schema.groups)
    .where(and(isNull(schema.groups.deletedAt), isNull(schema.groups.archivedAt)))
  let digests = 0
  for (const project of projects) {
    const settings = notificationConfigOf(project.notificationConfig, project.notifyEmails)
    if (settings.emails.length === 0) continue
    if (!settings.events.unsigned_digest && !settings.events.expiring_digest) continue
    const inProject = sql`${schema.agreements.id} in (
      select pl.agreement_id from ${schema.projectLeads} pl where pl.group_id = ${project.id} and pl.agreement_id is not null
      union
      select bi.agreement_id from ${schema.bulkBatchItems} bi join ${schema.bulkBatches} bb on bb.id = bi.batch_id where bb.group_id = ${project.id} and bi.agreement_id is not null
    )`
    const [unsigned, expiring] = await Promise.all([
      settings.events.unsigned_digest ? attentionRows(and(inProject, lt(schema.agreements.sentAt, staleCutoff))) : [],
      settings.events.expiring_digest ? attentionRows(and(inProject, isNotNull(schema.agreements.expiresAt), between(schema.agreements.expiresAt, new Date(), soon))) : [],
    ])
    if (unsigned.length === 0 && expiring.length === 0) continue
    const rendered = await attentionMail(await brandFor({ organizationId: project.organizationId }), project.name, unsigned, expiring, publicUrl(`/projects/${project.id}?tab=agreements`))
    const email = new InforuEmailProvider()
    await Promise.allSettled(settings.emails.map((to) => email.send({ to, ...rendered })))
    digests++
  }
  return digests
}

type WaitingRow = { id: string; title: string; status: string; sentAt: Date | null; expiresAt: Date | null; company: string | null; recipient: string | null }

/** Open agreements matching a condition, with what a person needs to recognise them. */
async function attentionRows(where: ReturnType<typeof and>): Promise<WaitingRow[]> {
  return getDb()
    .select({
      id: schema.agreements.id,
      title: schema.agreements.title,
      status: schema.agreements.status,
      sentAt: schema.agreements.sentAt,
      expiresAt: schema.agreements.expiresAt,
      company: schema.companies.name,
      recipient: sql<string | null>`(select r.name from ${schema.recipients} r where r.agreement_id = ${schema.agreements.id} limit 1)`,
    })
    .from(schema.agreements)
    .leftJoin(schema.companies, eq(schema.companies.id, schema.agreements.companyId))
    .where(and(where, inArray(schema.agreements.status, ['sent', 'viewed']), isNull(schema.agreements.deletedAt), isNull(schema.agreements.archivedAt)))
    .limit(50)
}

async function attentionMail(brand: EmailBrand, projectName: string | null, unsigned: WaitingRow[], expiring: WaitingRow[], openUrl: string) {
  const days = (from: Date | null) => (from ? Math.max(0, Math.round((Date.now() - from.getTime()) / 86_400_000)) : 0)
  const until = (to: Date | null) => (to ? Math.max(0, Math.round((to.getTime() - Date.now()) / 86_400_000)) : 0)
  const row = (r: WaitingRow, when: string): AttentionRow => ({
    document: r.title,
    company: r.company,
    recipient: r.recipient,
    status: r.status === 'viewed' ? 'נצפה' : 'ממתין לחתימה',
    when,
    url: publicUrl(`/documents/${r.id}`),
  })
  const sections = [
    ...(unsigned.length ? [{ heading: `ממתינים לחתימה כבר ${FIRST_REMINDER_AFTER_DAYS} ימים ומעלה (${unsigned.length})`, rows: unsigned.slice(0, 10).map((r) => row(r, `נשלח לפני ${days(r.sentAt)} ימים`)) }] : []),
    ...(expiring.length ? [{ heading: `קישורים שיפוגו בשבוע הקרוב (${expiring.length})`, rows: expiring.slice(0, 10).map((r) => row(r, `פג בעוד ${until(r.expiresAt)} ימים`)) }] : []),
  ]
  const total = unsigned.length + expiring.length
  const subject = projectName ? `סיכום יומי – ${projectName}: ${total} הסכמים דורשים תשומת לב` : `סיכום יומי: ${total} הסכמים דורשים תשומת לב`
  return renderEmail(
    subject,
    AttentionEmail({
      brand,
      title: 'הסכמים שדורשים תשומת לב',
      intro: projectName ? `סיכום הבוקר לקמפיין "${projectName}": מה עדיין ממתין, ומה עומד לפוג.` : 'סיכום הבוקר של XTRA Sign: מה עדיין ממתין, ומה עומד לפוג.',
      sections,
      openUrl,
    }),
  )
}
