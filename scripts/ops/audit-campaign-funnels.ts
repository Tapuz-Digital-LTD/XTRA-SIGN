import { sql } from 'drizzle-orm'
import { getDb } from '../../src/server/db'

/**
 * Read-only audit of one campaign's funnels.
 *
 * Every number here is counted from the row that owns the fact — an
 * invitation from `project_leads.invited_by`, a submitted form from
 * `form_snapshot`, a signature from `agreements.status`, a reminder from a
 * `message_sends` row the provider accepted — and never from an analytics
 * event where a business record exists. Where a fact was never collected the
 * script says so instead of printing a number that looks right.
 *
 *   PROJECT_NAME='חודש התיירות הישראלית 2026' \
 *     npx dotenv-cli -e .env.vercel.production -- npx tsx scripts/ops/audit-campaign-funnels.ts
 *
 * Nothing is written. Every statement below is a select.
 */

const PROJECT_NAME = process.env.PROJECT_NAME ?? 'חודש התיירות הישראלית 2026'
/** A visit is one browser; a session closes after this much silence (the common web-analytics rule). */
const SESSION_GAP_MINUTES = 30

const db = getDb()
const one = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T> => ((await db.execute(query)).rows[0] ?? {}) as T
const rows = async <T extends Record<string, unknown>>(query: ReturnType<typeof sql>): Promise<T[]> => (await db.execute(query)).rows as T[]
const n = (v: unknown) => Number(v ?? 0)
const pct = (num: number, den: number) => (den > 0 ? `${Math.round((num / den) * 1000) / 10}%` : '—')

function table(title: string, lines: [string, string | number, string?][]) {
  console.log(`\n${title}`)
  console.log('─'.repeat(78))
  for (const [label, value, note] of lines) {
    console.log(`  ${label.padEnd(42)} ${String(value).padStart(8)}   ${note ?? ''}`)
  }
}

async function main() {
  const group = await one<{ id: string; name: string; created_at: Date }>(sql`
    select id, name, created_at from groups where name = ${PROJECT_NAME} and deleted_at is null limit 1`)
  if (!group.id) throw new Error(`no campaign named ${PROJECT_NAME}`)
  const g = group.id
  console.log(`campaign: ${group.name}  (${g})`)
  console.log(`opened:   ${new Date(group.created_at).toISOString().slice(0, 10)}`)

  // ── What the two routes are ────────────────────────────────────────────
  // A personal invitation is a lead a member of staff created (invited_by).
  // Everyone else arrived on their own. One row is one person either way.
  const routes = await one<Record<string, unknown>>(sql`
    select
      count(*) filter (where pl.invited_by is not null)                                   as invited,
      count(*) filter (where pl.invited_by is null and pl.status <> 'pending')             as self_serve,
      count(*) filter (where pl.invited_by is null and pl.status = 'pending')              as self_pending
    from project_leads pl where pl.group_id = ${g}`)

  // ── Invitation funnel ──────────────────────────────────────────────────
  const inv = await one<Record<string, unknown>>(sql`
    with invited as (
      select pl.id, pl.agreement_id, pl.form_snapshot, pl.created_at
      from project_leads pl
      where pl.group_id = ${g} and pl.invited_by is not null
    )
    select
      (select count(*) from invited)                                                        as invited,
      (select count(*) from invited i where exists (
         select 1 from message_sends m
         where m.lead_id = i.id and m.ok and m.is_test = false and m.event = 'invitation'))  as sent,
      (select count(*) from invited i where exists (
         select 1 from campaign_events e where e.invitation_id = i.id))                     as opened,
      (select count(*) from invited i where i.form_snapshot is not null)                    as submitted,
      (select count(*) from invited i join agreements a on a.id = i.agreement_id
         where exists (select 1 from audit_events ae
                       where ae.agreement_id = a.id and ae.type in ('viewed','otp_sent')))   as signing_started,
      (select count(*) from invited i join agreements a on a.id = i.agreement_id
         where a.status = 'signed')                                                          as signed`)

  // ── Site funnel: only visits that did not arrive through a personal link ──
  const visits = await one<Record<string, unknown>>(sql`
    with own_visits as (
      select e.visit_id
      from campaign_events e
      where e.group_id = ${g}
      group by e.visit_id
      having count(*) filter (where e.invitation_id is not null) = 0
    )
    select
      (select count(*) from own_visits)                                                     as visitors,
      (select count(distinct e.visit_id) from campaign_events e
         join own_visits v on v.visit_id = e.visit_id
         where e.group_id = ${g} and e.type = 'registration_started')                        as started_form,
      (select count(distinct e.visit_id) from campaign_events e
         join own_visits v on v.visit_id = e.visit_id
         where e.group_id = ${g} and e.type = 'registration_completed')                      as completed_form_event,
      (select count(*) from campaign_events e where e.group_id = ${g})                       as events_total,
      (select min(e.created_at) from campaign_events e where e.group_id = ${g})              as first_event`)

  // Sessions, by the 30-minute silence rule, for visits of their own.
  const sessions = await one<{ sessions: unknown }>(sql`
    with own_visits as (
      select e.visit_id from campaign_events e where e.group_id = ${g}
      group by e.visit_id having count(*) filter (where e.invitation_id is not null) = 0
    ),
    ordered as (
      select e.visit_id, e.created_at,
             lag(e.created_at) over (partition by e.visit_id order by e.created_at) as prev
      from campaign_events e join own_visits v on v.visit_id = e.visit_id
      where e.group_id = ${g}
    )
    select count(*) filter (where prev is null or created_at - prev > ${`${SESSION_GAP_MINUTES} minutes`}::interval) as sessions from ordered`)

  const self = await one<Record<string, unknown>>(sql`
    with own as (
      select pl.id, pl.agreement_id, pl.form_snapshot
      from project_leads pl where pl.group_id = ${g} and pl.invited_by is null and pl.status <> 'pending'
    )
    select
      (select count(*) from own)                                                            as registrations,
      (select count(*) from own o where o.form_snapshot is not null)                        as submitted,
      (select count(*) from own o join agreements a on a.id = o.agreement_id
         where exists (select 1 from audit_events ae
                       where ae.agreement_id = a.id and ae.type in ('viewed','otp_sent')))   as signing_started,
      (select count(*) from own o join agreements a on a.id = o.agreement_id
         where a.status = 'signed')                                                          as signed`)

  // ── Reminders ──────────────────────────────────────────────────────────
  // Two records exist, and they disagree. `message_sends` is the ledger of
  // what left, but until 2026-09-10 every reminder was filed there as an
  // "invitation" (deliverSigningLink defaulted the event), which both hid the
  // reminders and inflated the invitations. `audit_events.reminder_sent` is
  // written by the reminder path itself and is the honest historical record.
  const rem = await one<Record<string, unknown>>(sql`
    with campaign_agreements as (
      select pl.id as lead_id, pl.agreement_id, a.status, a.created_at, a.completed_at
      from project_leads pl join agreements a on a.id = pl.agreement_id
      where pl.group_id = ${g}
    ),
    ledger as (
      select m.*, coalesce(m.lead_id, (select c.lead_id from campaign_agreements c where c.agreement_id = m.agreement_id limit 1)) as person
      from message_sends m
      where m.group_id = ${g} and m.event = 'reminder' and m.ok and m.is_test = false
    ),
    trail as (
      select ae.agreement_id, ae.created_at
      from audit_events ae
      where ae.type = 'reminder_sent' and ae.agreement_id in (select agreement_id from campaign_agreements)
    )
    select
      (select count(*) from ledger)                                                         as ledger_sent,
      (select count(distinct person) from ledger where person is not null)                  as ledger_people,
      (select count(*) from trail)                                                          as trail_sent,
      (select count(distinct agreement_id) from trail)                                      as trail_people,
      (select count(distinct t.agreement_id) from trail t join campaign_agreements c on c.agreement_id = t.agreement_id
         where c.status = 'signed' and c.completed_at is not null and t.created_at < c.completed_at) as signed_after_reminder,
      (select count(distinct t.agreement_id) from trail t join campaign_agreements c on c.agreement_id = t.agreement_id
         where c.status <> 'signed')                                                        as reminded_not_signed`)

  // "The last message that reached them before signing was a reminder."
  const lastTouch = await one<{ n: unknown }>(sql`
    select count(*) as n from (
      select distinct on (a.id) a.id, m.event
      from agreements a
      join project_leads pl on pl.agreement_id = a.id and pl.group_id = ${g}
      join message_sends m on coalesce(m.lead_id, (select pl2.id from project_leads pl2 where pl2.agreement_id = m.agreement_id limit 1)) = pl.id
      where a.status = 'signed' and a.completed_at is not null and m.ok and m.is_test = false and m.sent_at < a.completed_at
      order by a.id, m.sent_at desc) x
    where x.event = 'reminder'`)

  const signedTotal = await one<{ n: unknown }>(sql`
    select count(*) as n from project_leads pl join agreements a on a.id = pl.agreement_id
    where pl.group_id = ${g} and a.status = 'signed'`)

  // ── Where the traffic came from, our own domains excluded ─────────────
  const sources = await rows<{ source: string; visitors: unknown }>(sql`
    with own_visits as (
      select e.visit_id from campaign_events e where e.group_id = ${g}
      group by e.visit_id having count(*) filter (where e.invitation_id is not null) = 0
    ),
    first_touch as (
      select distinct on (e.visit_id) e.visit_id, e.utm->>'utm_source' as utm, e.referrer
      from campaign_events e join own_visits v on v.visit_id = e.visit_id
      where e.group_id = ${g}
      order by e.visit_id, e.created_at
    )
    select
      case
        when utm is not null then 'utm:' || utm
        when referrer is null or referrer = '' then 'direct'
        when referrer ilike '%xtra.co.il' or referrer ilike '%xtra-sign.vercel.app' then 'internal'
        when referrer ilike '%google%' then 'google'
        when referrer ilike '%facebook%' or referrer ilike '%instagram%' or referrer ilike '%t.co' then 'social'
        else 'referral:' || referrer
      end as source,
      count(*) as visitors
    from first_touch group by 1 order by 2 desc limit 12`)

  // ── The report ─────────────────────────────────────────────────────────
  const invited = n(inv.invited)
  table('1 · שני המסלולים', [
    ['הזמנות אישיות (מוזמנים ייחודיים)', invited],
    ['הגיעו בעצמם — נרשמו', n(routes.self_serve)],
    ['הגיעו בעצמם — פתחו ולא הגישו (pending)', n(routes.self_pending)],
  ])

  table('2 · משפך ההזמנות האישיות', [
    ['הוזמנו', invited, 'project_leads.invited_by'],
    ['נשלחה להם הזמנה בפועל', n(inv.sent), `${pct(n(inv.sent), invited)} · message_sends event=invitation, ok`],
    ['פתחו את הקישור האישי', n(inv.opened), `${pct(n(inv.opened), invited)} · campaign_events.invitation_id`],
    ['הגישו טופס', n(inv.submitted), `${pct(n(inv.submitted), invited)} · project_leads.form_snapshot`],
    ['התחילו חתימה', n(inv.signing_started), `${pct(n(inv.signing_started), invited)} · audit_events viewed/otp_sent`],
    ['חתמו', n(inv.signed), `${pct(n(inv.signed), invited)} · agreements.status=signed`],
  ])

  table('3 · משפך ההגעה העצמאית מהאתר', [
    ['מבקרים ייחודיים (דפדפנים, ללא הזמנה אישית)', n(visits.visitors), 'campaign_events.visit_id'],
    [`ביקורים (session, ${SESSION_GAP_MINUTES} דק׳ שקט)`, n(sessions.sessions), 'נגזר מהאירועים'],
    ['התחילו טופס', n(visits.started_form), `${pct(n(visits.started_form), n(visits.visitors))} מהמבקרים`],
    ['הגישו טופס (הרשמות אמיתיות)', n(self.submitted), `${pct(n(self.submitted), n(visits.visitors))} מהמבקרים`],
    ['התחילו חתימה', n(self.signing_started), ''],
    ['חתמו', n(self.signed), `${pct(n(self.signed), n(visits.visitors))} מהמבקרים · ${pct(n(self.signed), n(self.submitted))} מהמגישים`],
  ])

  table('4 · תזכורות', [
    ['תזכורות ביומן ההודעות (event=reminder)', n(rem.ledger_sent), 'לפני 10.9.2026 נרשמו בטעות כ-invitation'],
    ['תזכורות ביומן הביקורת (reminder_sent)', n(rem.trail_sent), 'הרישום ההיסטורי האמין'],
    ['אנשים ייחודיים שקיבלו תזכורת', n(rem.trail_people)],
    ['חתמו לאחר שנשלחה תזכורת', n(rem.signed_after_reminder), `${pct(n(rem.signed_after_reminder), n(rem.trail_people))} מהמקבלים`],
    ['התזכורת הייתה הקשר האחרון לפני החתימה', n(lastTouch.n), 'מיומן ההודעות — לא ניתן היסטורית'],
    ['קיבלו תזכורת ועדיין לא חתמו', n(rem.reminded_not_signed)],
    ['ממוצע תזכורות לאדם', n(rem.trail_people) > 0 ? Math.round((n(rem.trail_sent) / n(rem.trail_people)) * 10) / 10 : '—'],
  ])

  table('5 · חתימות לפי מקור', [
    ['חתימות מהזמנה אישית', n(inv.signed), pct(n(inv.signed), invited) + ' המרה'],
    ['חתימות מהגעה עצמאית', n(self.signed), pct(n(self.signed), n(visits.visitors)) + ' המרה מהמבקרים'],
    ['סה״כ חתימות בקמפיין', n(signedTotal.n)],
  ])

  console.log('\n6 · מקורות התנועה באתר (מגע ראשון של כל מבקר)')
  console.log('─'.repeat(78))
  if (sources.length === 0) console.log('  אין נתוני תנועה.')
  for (const s of sources) console.log(`  ${String(s.source).padEnd(42)} ${String(n(s.visitors)).padStart(8)}`)

  console.log('\n7 · מה לא נאסף')
  console.log('─'.repeat(78))
  console.log(`  אירועי אתר בסך הכול: ${n(visits.events_total)}, הראשון ב-${visits.first_event ? new Date(String(visits.first_event)).toISOString().slice(0, 10) : '—'}`)
  console.log(`  visit_id הוא מזהה לכל דפדפן (localStorage), לא session — "ביקורים" נגזרים ממנו בכלל ${SESSION_GAP_MINUTES} דק׳.`)
  console.log('  "הגישו טופס" של מבקר עצמאי נספר מ-project_leads, לא מאירוע: registration_completed נרשם רק מהדפדפן.')
  console.log('  תזכורות היסטוריות נרשמו ביומן ההודעות כ-"invitation" (באג שתוקן) — לכן "נשלחה הזמנה" למעלה מנופח, והתזכורות נספרות מיומן הביקורת.')
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
