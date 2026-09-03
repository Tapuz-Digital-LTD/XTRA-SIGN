import { and, between, eq, inArray, isNotNull, isNull, lt } from 'drizzle-orm'
import { NextResponse } from 'next/server'
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
    const text = `תזכורת: מחכה לך מסמך לחתימה מ-XTRA — "${row.title}". הקישור נשלח אליך קודם לכן.`

    const results = await Promise.all([
      row.email
        ? new InforuEmailProvider().send({
            to: row.email,
            subject: `תזכורת: ${row.title}`,
            text,
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
      wantUnsigned
        ? db
            .select({ title: schema.agreements.title })
            .from(schema.agreements)
            .where(
              and(
                eq(schema.agreements.organizationId, org.id),
                inArray(schema.agreements.status, ['sent', 'viewed']),
                lt(schema.agreements.sentAt, staleCutoff),
              ),
            )
            .limit(50)
        : [],
      wantExpiring
        ? db
            .select({ title: schema.agreements.title })
            .from(schema.agreements)
            .where(
              and(
                eq(schema.agreements.organizationId, org.id),
                inArray(schema.agreements.status, ['sent', 'viewed']),
                isNotNull(schema.agreements.expiresAt),
                between(schema.agreements.expiresAt, new Date(now), soon),
              ),
            )
            .limit(50)
        : [],
    ])

    if (unsigned.length === 0 && expiring.length === 0) continue

    const list = (rows: { title: string }[]) =>
      rows
        .slice(0, 10)
        .map((r) => `• ${r.title}`)
        .join('\n') + (rows.length > 10 ? `\nועוד ${rows.length - 10}…` : '')

    const sections: string[] = []
    if (unsigned.length > 0) sections.push(`ממתינים לחתימה כבר ${FIRST_REMINDER_AFTER_DAYS} ימים ומעלה (${unsigned.length}):\n${list(unsigned)}`)
    if (expiring.length > 0) sections.push(`קישורים שיפוגו בשבוע הקרוב (${expiring.length}):\n${list(expiring)}`)
    const text = `סיכום יומי מ-XTRA Sign\n\n${sections.join('\n\n')}\n\n${publicUrl('/agreements?filter=pending')}`

    const email = new InforuEmailProvider()
    await Promise.allSettled(
      prefs.emails.map((to) =>
        email.send({
          to,
          subject: `סיכום יומי: ${unsigned.length + expiring.length} הסכמים דורשים תשומת לב`,
          text,
        }),
      ),
    )
    digests++
  }
  return digests
}
