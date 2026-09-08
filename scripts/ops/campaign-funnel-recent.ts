import { sql } from 'drizzle-orm'
import { getDb } from '@/server/db'

/**
 * READ-ONLY. The last days of one campaign, as the tables tell it: every
 * registration row (who, when, from where, what its agreement did), the funnel
 * events per day, and visits that started the form but never submitted it.
 *
 *   npx dotenv -e .env.production.pulled -- npx tsx scripts/ops/campaign-funnel-recent.ts <groupId> [days]
 */
const GROUP = process.argv[2]
const DAYS = Number(process.argv[3] ?? 7)
if (!GROUP) throw new Error('groupId required')
const db = getDb()
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[]
const tail = (v: unknown) => (typeof v === 'string' && v.length > 3 ? `…${v.slice(-3)}` : '—')

async function main() {
  const since = new Date(Date.now() - DAYS * 86_400_000)
  console.log(`\n## registrations (project_leads) in the last ${DAYS} days`)
  const leads = await rows(sql`
    select pl.id, pl.created_at, pl.status, pl.source, pl.invited_by is not null as invited, pl.form_snapshot is not null as submitted,
           pl.data->>'name' as name, pl.phone, pl.company_id is not null as has_company, pl.meta->'attribution'->'last'->>'source' as last_touch, pl.meta->>'utm_source' as utm,
           a.status as agreement_status, a.sent_at, a.completed_at,
           (select count(*) from message_sends ms where ms.agreement_id = a.id or ms.lead_id = pl.id) as sends,
           (select count(*) from audit_events e where e.agreement_id = a.id and e.type = 'viewed') as views,
           (select count(*) from follow_up_tasks t where t.lead_id = pl.id) as tasks
    from project_leads pl left join agreements a on a.id = pl.agreement_id
    where pl.group_id = ${GROUP} and pl.created_at > ${since}
    order by pl.created_at`)
  for (const l of leads) console.log(JSON.stringify({ ...l, phone: tail(l.phone), created_at: String(l.created_at), sent_at: l.sent_at ? String(l.sent_at) : null, completed_at: l.completed_at ? String(l.completed_at) : null }))

  console.log(`\n## all-time counts for the campaign`)
  console.log(JSON.stringify((await rows(sql`
    select
      (select count(*) from project_leads where group_id = ${GROUP}) as leads_total,
      (select count(*) from project_leads where group_id = ${GROUP} and form_snapshot is not null) as leads_submitted,
      (select count(*) from project_leads where group_id = ${GROUP} and status = 'invited') as leads_invited,
      (select count(*) from project_leads where group_id = ${GROUP} and status = 'converted') as leads_converted,
      (select count(*) from project_leads where group_id = ${GROUP} and status = 'failed') as leads_failed,
      (select count(*) from project_leads where group_id = ${GROUP} and status = 'pending') as leads_pending,
      (select count(*) from company_groups where group_id = ${GROUP}) as companies_in_group,
      (select count(*) from project_leads pl join agreements a on a.id = pl.agreement_id where pl.group_id = ${GROUP} and a.status = 'signed') as leads_signed,
      (select count(*) from project_leads pl join agreements a on a.id = pl.agreement_id where pl.group_id = ${GROUP} and a.status in ('sent','viewed')) as leads_open_agreement,
      (select count(*) from project_leads pl join agreements a on a.id = pl.agreement_id where pl.group_id = ${GROUP} and a.status not in ('sent','viewed','signed')) as leads_other_agreement,
      (select count(*) from follow_up_tasks where group_id = ${GROUP}) as tasks`))[0]))

  console.log(`\n## funnel events per day (last ${DAYS} days)`)
  for (const r of await rows(sql`select date_trunc('day', created_at)::date as day, type, count(*) as n, count(distinct visit_id) as visits from campaign_events where group_id = ${GROUP} and created_at > ${since} group by 1, 2 order by 1, 2`)) console.log(JSON.stringify({ ...r, day: String(r.day) }))

  console.log(`\n## visits that started the form but never submitted (last ${DAYS} days)`)
  for (const r of await rows(sql`
    select visit_id, min(created_at) as first_seen, max(created_at) as last_seen, array_agg(distinct type) as types
    from campaign_events where group_id = ${GROUP} and created_at > ${since}
    group by visit_id
    having bool_or(type = 'registration_started') and not bool_or(type = 'registration_completed')
    order by 2`)) console.log(JSON.stringify({ ...r, first_seen: String(r.first_seen), last_seen: String(r.last_seen) }))
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
