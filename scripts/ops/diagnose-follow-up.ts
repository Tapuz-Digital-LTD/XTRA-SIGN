import { and, eq, ilike, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'

/** Read-only: is the site-product task configured and created for the campaign's signed participants? */
const CAMPAIGN = process.env.CAMPAIGN ?? 'התיירות'
async function main() {
  const db = getDb()
  const [g] = await db.select({ id: schema.groups.id, name: schema.groups.name, followUpConfig: schema.groups.followUpConfig }).from(schema.groups).where(and(isNull(schema.groups.deletedAt), ilike(schema.groups.name, `%${CAMPAIGN}%`))).limit(1)
  if (!g) throw new Error('campaign not found')
  console.log(`campaign: ${g.name}`)
  console.log(`follow_up_config: ${JSON.stringify(g.followUpConfig)}`)
  const [signed] = await db.execute(sql`select count(*)::int as n from project_leads pl join agreements a on a.id = pl.agreement_id where pl.group_id = ${g.id} and a.status = 'signed'`).then((r) => r.rows as { n: number }[])
  const [withTask] = await db.execute(sql`select count(*)::int as n from project_leads pl join agreements a on a.id = pl.agreement_id where pl.group_id = ${g.id} and a.status = 'signed' and exists (select 1 from follow_up_tasks t where t.lead_id = pl.id and t.kind = 'site_product')`).then((r) => r.rows as { n: number }[])
  const tasks = await db.execute(sql`select status, count(*)::int as n from follow_up_tasks where group_id = ${g.id} group by status`).then((r) => r.rows as { status: string; n: number }[])
  console.log(`signed participants: ${signed.n}; with a site_product task: ${withTask.n}`)
  console.log(`tasks by status: ${tasks.length ? tasks.map((t) => `${t.status}=${t.n}`).join(', ') : 'none'}`)
  const names = await db.execute(sql`select coalesce(pl.data->>'name', pl.data->>'businessName') as name, a.completed_at, pl.company_id is not null as has_company from project_leads pl join agreements a on a.id = pl.agreement_id where pl.group_id = ${g.id} and a.status = 'signed' order by a.completed_at`).then((r) => r.rows as { name: string; completed_at: Date; has_company: boolean }[])
  for (const n of names) console.log(`  signed: ${n.name} · ${new Date(n.completed_at).toISOString().slice(0, 10)} · company=${n.has_company}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
