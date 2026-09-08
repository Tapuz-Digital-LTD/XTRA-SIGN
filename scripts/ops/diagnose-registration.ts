import { desc, eq, ilike, or, sql } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/** Read-only: one registration's story — form, agreement, views, sends. Addresses masked. */
const NEEDLE = process.argv[2] ?? ''
const mask = (s: string | null | undefined) => (s ? s.replace(/(.{2}).+(@|.{3}$)/, '$1…$2') : '—')
async function main() {
  const db = getDb()
  const leads = await db.select().from(schema.projectLeads).where(or(sql`${schema.projectLeads.data}->>'name' ilike ${`%${NEEDLE}%`}`, sql`${schema.projectLeads.data}->>'businessName' ilike ${`%${NEEDLE}%`}`)).orderBy(desc(schema.projectLeads.createdAt)).limit(3)
  for (const l of leads) {
    const d = l.data as Record<string, string>
    console.log(`\n# ${d.name ?? d.businessName} · lead status=${l.status} · source=${l.source} · invited_by=${l.invitedBy ? 'yes' : 'no'} · created=${l.createdAt.toISOString()} · form_snapshot=${l.formSnapshot ? 'yes' : 'no'}`)
    console.log(`  meta: ${JSON.stringify({ utm_source: (l.meta as Record<string, unknown> | null)?.utm_source ?? null, attribution: (l.meta as Record<string, unknown> | null)?.attribution ?? null })}`)
    if (!l.agreementId) continue
    const [a] = await db.select().from(schema.agreements).where(eq(schema.agreements.id, l.agreementId))
    console.log(`  agreement: status=${a.status} sent=${a.sentAt?.toISOString() ?? '—'} completed=${a.completedAt?.toISOString() ?? '—'} expires=${a.expiresAt?.toISOString() ?? '—'}`)
    const audit = await db.select({ type: schema.auditEvents.type, at: schema.auditEvents.createdAt, meta: schema.auditEvents.metadata }).from(schema.auditEvents).where(eq(schema.auditEvents.agreementId, a.id)).orderBy(desc(schema.auditEvents.createdAt)).limit(12)
    for (const e of audit) console.log(`  audit ${e.at.toISOString()} ${e.type} ${e.meta ? JSON.stringify(e.meta).slice(0, 90) : ''}`)
    const sends = await db.select({ at: schema.messageSends.sentAt, channel: schema.messageSends.channel, event: schema.messageSends.event, to: schema.messageSends.recipient, ok: schema.messageSends.ok, error: schema.messageSends.error }).from(schema.messageSends).where(eq(schema.messageSends.agreementId, a.id)).orderBy(desc(schema.messageSends.sentAt))
    for (const s of sends) console.log(`  send ${s.at.toISOString()} ${s.channel}/${s.event} to=${mask(s.to)} ok=${s.ok} ${s.error ?? ''}`)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
