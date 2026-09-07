import { desc, ilike, inArray, or } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/**
 * Read-only: what was sent (and what failed) for the agreements whose
 * recipient or title matches. Prints no secrets; addresses are masked.
 *
 *   dotenv -e .env.prod.setup -- tsx scripts/ops/diagnose-sends.ts "רפי"
 */
const needle = process.argv[2] ?? ''
const mask = (s: string | null) => (s ? s.replace(/(.{2}).+(@|.{3}$)/, '$1…$2') : '—')

async function main() {
  const db = getDb()
  const recips = await db
    .select({ id: schema.recipients.id, agreementId: schema.recipients.agreementId, name: schema.recipients.name, phone: schema.recipients.phone, email: schema.recipients.email, signedAt: schema.recipients.signedAt })
    .from(schema.recipients)
    .where(or(ilike(schema.recipients.name, `%${needle}%`), ilike(schema.recipients.email, `%${needle}%`)))
    .limit(10)
  const ids = [...new Set(recips.map((r) => r.agreementId))]
  if (!ids.length) { console.log('no recipients match'); return }
  const agreements = await db.select({ id: schema.agreements.id, title: schema.agreements.title, status: schema.agreements.status, completedAt: schema.agreements.completedAt, companyId: schema.agreements.companyId }).from(schema.agreements).where(inArray(schema.agreements.id, ids))
  const sends = await db.select({ agreementId: schema.messageSends.agreementId, sentAt: schema.messageSends.sentAt, channel: schema.messageSends.channel, event: schema.messageSends.event, recipient: schema.messageSends.recipient, ok: schema.messageSends.ok, isTest: schema.messageSends.isTest, providerMessageId: schema.messageSends.providerMessageId, error: schema.messageSends.error }).from(schema.messageSends).where(inArray(schema.messageSends.agreementId, ids)).orderBy(desc(schema.messageSends.sentAt))
  const audit = await db.select({ agreementId: schema.auditEvents.agreementId, type: schema.auditEvents.type, at: schema.auditEvents.createdAt, meta: schema.auditEvents.metadata }).from(schema.auditEvents).where(inArray(schema.auditEvents.agreementId, ids)).orderBy(desc(schema.auditEvents.createdAt)).limit(40)
  for (const a of agreements) {
    console.log(`\n# ${a.title} — status=${a.status} completedAt=${a.completedAt?.toISOString() ?? '—'} company=${a.companyId ? 'yes' : 'none'}`)
    for (const r of recips.filter((r) => r.agreementId === a.id)) console.log(`  recipient: ${r.name} phone=${mask(r.phone)} email=${mask(r.email)} signedAt=${r.signedAt?.toISOString() ?? '—'}`)
    for (const s of sends.filter((s) => s.agreementId === a.id)) console.log(`  send ${s.sentAt.toISOString()} ${s.channel}/${s.event} to=${mask(s.recipient)} ok=${s.ok} test=${s.isTest} provider=${s.providerMessageId ? 'yes' : '—'} error=${s.error ?? '—'}`)
    for (const e of audit.filter((e) => e.agreementId === a.id)) console.log(`  audit ${e.at.toISOString()} ${e.type} ${e.meta ? JSON.stringify(e.meta).slice(0, 160) : ''}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
