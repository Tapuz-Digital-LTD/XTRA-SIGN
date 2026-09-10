import { sql, type SQL } from 'drizzle-orm'
import { getDb } from '@/server/db'

/**
 * What actually happened in a campaign, counted from the rows that own the
 * facts.
 *
 * The whole screen rests on one distinction, and it is never blurred: a
 * person we invited ourselves, and a person who found the campaign page and
 * started on their own. "Direct" is a traffic source inside the second
 * group — it is not an invitation, and it never appears as one.
 *
 * Where a business record exists it wins over an analytics event: an
 * invitation is a `project_leads` row a member of staff created, a submitted
 * form is `form_snapshot`, a signature is `agreements.status = 'signed'`, a
 * reminder is an audit event the reminder path wrote. Events are used for
 * the two things only they know: that a personal link was opened, and that
 * somebody was on the page at all. Where the site's own traffic came from is
 * `sources()` in project-report.ts, which shares one classifier with every
 * other screen (`classifySource`).
 *
 * Definitions, in one place, because every percentage on the screen points
 * back here:
 *
 *   מוזמן          one project_leads row with invited_by. Sending the same
 *                  invitation again does not make a second person.
 *   פתח            at least one campaign_event carrying that invitation's id.
 *   הגיש טופס      the lead holds a form snapshot.
 *   התחיל חתימה    the agreement has a `viewed` or `otp_sent` audit event.
 *   חתם            agreements.status = 'signed'.
 *   מבקר           one visit_id (a browser, minted in localStorage) whose
 *                  events never carried an invitation id.
 *   ביקור          a run of that browser's events with no gap longer than
 *                  SESSION_GAP; the usual web-analytics session rule, stated
 *                  here because visit_id itself is not a session.
 *
 * A date range, when given, is applied to the moment a person entered the
 * process (the lead's creation, the visit's first event) — never to the
 * signature, so a funnel always describes the same cohort.
 */

/** A browser is one visitor; a new visit starts after this much silence. */
export const SESSION_GAP_MINUTES = 30

export type Range = { from?: Date; to?: Date }

export type FunnelStep = {
  key: string
  label: string
  /** Unique people (or browsers, in the site funnel). */
  people: number
  /** Of the step before it, and of the first step. */
  fromPrevious: number | null
  fromStart: number | null
  /** What this number is counted from, shown as a hint. */
  source: string
  /**
   * More people at this step than at the one before it. Real, and worth
   * saying out loud rather than printing a percentage over 100: a form can
   * be submitted by someone whose visit was never measured (an older
   * registration, a browser that blocked the events call, a row created by
   * staff), and a funnel that hides that is lying about its denominator.
   */
  exceedsPrevious: boolean
  /** The list that holds these people, when one exists. */
  href?: string
}

export type StuckCard = { key: string; label: string; count: number; href: string; hint: string }

export type CampaignFunnels = {
  headline: {
    invited: number
    invitedSigned: number
    invitedConversion: number | null
    visitors: number
    sessions: number
    siteRegistrations: number
    siteSigned: number
    siteConversion: number | null
    /** Of the people who actually submitted a form on the site — the rate that says whether the form works. */
    siteSubmittedToSigned: number | null
    signedTotal: number
  }
  invitations: FunnelStep[]
  site: FunnelStep[]
  reminders: {
    sent: number
    people: number
    signedAfter: number
    remindedNotSigned: number
    perPerson: number | null
    /** Sends the provider accepted, when the ledger holds them; null before reminders were labelled. */
    delivered: number | null
    lastTouch: number | null
  }
  stuck: StuckCard[]
}

const rate = (num: number, den: number) => (den > 0 ? Math.round((num / den) * 1000) / 10 : null)
const n = (v: unknown) => Number(v ?? 0)

function step(key: string, label: string, people: number, previous: number | null, start: number, source: string, href?: string): FunnelStep {
  const exceedsPrevious = previous !== null && people > previous
  return {
    key,
    label,
    people,
    fromPrevious: previous === null || exceedsPrevious ? null : rate(people, previous),
    fromStart: people > start ? null : rate(people, start),
    source,
    exceedsPrevious,
    href,
  }
}

/** The range, against a column, as a condition that is always safe to `and` with. */
function within(column: SQL, range: Range): SQL {
  const parts: SQL[] = []
  if (range.from) parts.push(sql`${column} >= ${range.from}`)
  if (range.to) parts.push(sql`${column} < ${range.to}`)
  return parts.length ? sql.join(parts, sql` and `) : sql`true`
}

export async function campaignFunnels(groupId: string, range: Range = {}, projectPath = ''): Promise<CampaignFunnels> {
  const db = getDb()
  const href = (query: string) => (projectPath ? `${projectPath}${query}` : undefined)
  const leadRange = within(sql`pl.created_at`, range)
  const eventRange = within(sql`e.created_at`, range)

  const [invitations] = (
    await db.execute(sql`
      with invited as (
        select pl.id, pl.agreement_id, pl.form_snapshot
        from project_leads pl
        where pl.group_id = ${groupId} and pl.invited_by is not null and ${leadRange}
      )
      select
        (select count(*) from invited)                                                       as invited,
        (select count(*) from invited i
           where exists (select 1 from campaign_events e where e.invitation_id = i.id))       as opened,
        (select count(*) from invited i where i.form_snapshot is not null)                    as submitted,
        (select count(*) from invited i join agreements a on a.id = i.agreement_id
           where exists (select 1 from audit_events ae
                         where ae.agreement_id = a.id and ae.type in ('viewed', 'otp_sent'))) as started,
        (select count(*) from invited i join agreements a on a.id = i.agreement_id
           where a.status = 'signed')                                                         as signed`)
  ).rows as Record<string, unknown>[]

  const [site] = (
    await db.execute(sql`
      with own_visits as (
        select e.visit_id, min(e.created_at) as first_seen
        from campaign_events e
        where e.group_id = ${groupId} and ${eventRange}
        group by e.visit_id
        having count(*) filter (where e.invitation_id is not null) = 0
      ),
      ordered as (
        select e.visit_id, e.created_at,
               lag(e.created_at) over (partition by e.visit_id order by e.created_at) as prev
        from campaign_events e join own_visits v on v.visit_id = e.visit_id
        where e.group_id = ${groupId} and ${eventRange}
      ),
      own_leads as (
        select pl.id, pl.agreement_id, pl.form_snapshot
        from project_leads pl
        where pl.group_id = ${groupId} and pl.invited_by is null and pl.status <> 'pending' and ${leadRange}
      )
      select
        (select count(*) from own_visits)                                                     as visitors,
        (select count(*) from ordered
           where prev is null or created_at - prev > ${`${SESSION_GAP_MINUTES} minutes`}::interval) as sessions,
        (select count(distinct e.visit_id) from campaign_events e join own_visits v on v.visit_id = e.visit_id
           where e.group_id = ${groupId} and e.type = 'registration_started')                  as started_form,
        (select count(*) from own_leads)                                                       as submitted,
        (select count(*) from own_leads o join agreements a on a.id = o.agreement_id
           where exists (select 1 from audit_events ae
                         where ae.agreement_id = a.id and ae.type in ('viewed', 'otp_sent')))  as started_signing,
        (select count(*) from own_leads o join agreements a on a.id = o.agreement_id
           where a.status = 'signed')                                                          as signed`)
  ).rows as Record<string, unknown>[]

  /*
   * Reminders. The audit trail is what the reminder path writes, for every
   * reminder, and is the only complete record: until 2026-09-10 the message
   * ledger filed a reminder as an invitation. The ledger is read beside it
   * for the one thing it knows — whether the provider took it — and is null
   * while it holds none.
   */
  const [reminders] = (
    await db.execute(sql`
      with people as (
        select pl.id as lead_id, pl.agreement_id, a.status, a.completed_at
        from project_leads pl join agreements a on a.id = pl.agreement_id
        where pl.group_id = ${groupId} and ${leadRange}
      ),
      trail as (
        select ae.agreement_id, ae.created_at
        from audit_events ae
        where ae.type = 'reminder_sent' and ae.agreement_id in (select agreement_id from people)
      )
      select
        (select count(*) from trail)                                                           as sent,
        (select count(distinct agreement_id) from trail)                                       as people,
        (select count(distinct t.agreement_id) from trail t join people p on p.agreement_id = t.agreement_id
           where p.status = 'signed' and p.completed_at is not null and t.created_at < p.completed_at) as signed_after,
        (select count(distinct t.agreement_id) from trail t join people p on p.agreement_id = t.agreement_id
           where p.status <> 'signed')                                                         as not_signed,
        (select count(*) from message_sends m
           where m.group_id = ${groupId} and m.event = 'reminder' and m.ok and m.is_test = false) as delivered,
        (select count(*) from (
           select distinct on (p.agreement_id) p.agreement_id, m.event
           from people p
           join message_sends m on m.agreement_id = p.agreement_id
           where p.status = 'signed' and p.completed_at is not null and m.ok and m.is_test = false and m.sent_at < p.completed_at
           order by p.agreement_id, m.sent_at desc) x
         where x.event = 'reminder')                                                           as last_touch`)
  ).rows as Record<string, unknown>[]

  const [stuck] = (
    await db.execute(sql`
      with leads as (
        select pl.id, pl.agreement_id, pl.status, pl.invited_by, pl.form_snapshot
        from project_leads pl where pl.group_id = ${groupId} and ${leadRange}
      )
      select
        (select count(*) from leads l where l.invited_by is not null and l.form_snapshot is null
           and not exists (select 1 from campaign_events e where e.invitation_id = l.id))       as not_opened,
        (select count(*) from leads l where l.invited_by is not null and l.form_snapshot is null
           and exists (select 1 from campaign_events e where e.invitation_id = l.id))           as opened_not_submitted,
        (select count(*) from leads l left join agreements a on a.id = l.agreement_id
           where l.form_snapshot is not null and (a.id is null or a.status <> 'signed'))        as submitted_not_signed,
        (select count(distinct l.id) from leads l
           join audit_events ae on ae.agreement_id = l.agreement_id and ae.type = 'reminder_sent'
           left join agreements a on a.id = l.agreement_id
           where a.status is distinct from 'signed')                                            as reminded_not_signed,
        (select count(*) from leads l where l.status = 'failed')                                as failed`)
  ).rows as Record<string, unknown>[]

  const invited = n(invitations.invited)
  const invitedSigned = n(invitations.signed)
  const visitors = n(site.visitors)
  const siteSubmitted = n(site.submitted)
  const siteSigned = n(site.signed)

  return {
    headline: {
      invited,
      invitedSigned,
      invitedConversion: rate(invitedSigned, invited),
      visitors,
      sessions: n(site.sessions),
      siteRegistrations: siteSubmitted,
      siteSigned,
      siteConversion: rate(siteSigned, visitors),
      siteSubmittedToSigned: rate(siteSigned, siteSubmitted),
      signedTotal: invitedSigned + siteSigned,
    },
    invitations: [
      step('invited', 'הוזמנו', invited, null, invited, 'הזמנה אישית שנוצרה על ידי הצוות', href('?tab=joining&view=invitations')),
      step('opened', 'פתחו את הקישור', n(invitations.opened), invited, invited, 'נרשמה כניסה לעמוד עם הקישור האישי', href('?tab=joining&view=invitations')),
      step('submitted', 'הגישו טופס', n(invitations.submitted), n(invitations.opened), invited, 'טופס הרשמה שנשמר', href('?tab=joining&view=registrations')),
      step('started', 'התחילו חתימה', n(invitations.started), n(invitations.submitted), invited, 'נפתח המסמך או נשלח קוד אימות'),
      step('signed', 'חתמו', invitedSigned, n(invitations.started), invited, 'ההסכם נחתם', href('?tab=agreements&filter=signed')),
    ],
    site: [
      step('visitors', 'הגיעו לעמוד', visitors, null, visitors, 'דפדפנים ייחודיים שלא הגיעו דרך הזמנה אישית'),
      step('started_form', 'התחילו טופס', n(site.started_form), visitors, visitors, 'אירוע "התחלת טופס" באותו דפדפן'),
      step('submitted', 'הגישו טופס', siteSubmitted, n(site.started_form), visitors, 'הרשמה שנשמרה', href('?tab=joining&view=registrations')),
      step('started_signing', 'התחילו חתימה', n(site.started_signing), siteSubmitted, visitors, 'נפתח המסמך או נשלח קוד אימות'),
      step('signed', 'חתמו', siteSigned, n(site.started_signing), visitors, 'ההסכם נחתם', href('?tab=agreements&filter=signed')),
    ],
    reminders: {
      sent: n(reminders.sent),
      people: n(reminders.people),
      signedAfter: n(reminders.signed_after),
      remindedNotSigned: n(reminders.not_signed),
      perPerson: n(reminders.people) > 0 ? Math.round((n(reminders.sent) / n(reminders.people)) * 10) / 10 : null,
      delivered: n(reminders.delivered) > 0 ? n(reminders.delivered) : null,
      lastTouch: n(reminders.delivered) > 0 ? n(reminders.last_touch) : null,
    },
    stuck: [
      { key: 'not_opened', label: 'הוזמנו ולא פתחו', count: n(stuck.not_opened), href: `${projectPath}?tab=joining&view=invitations&stuck=not_opened`, hint: 'נשלחה הזמנה אישית, ואין כניסה לעמוד דרך הקישור שלהם.' },
      { key: 'opened_not_submitted', label: 'פתחו ולא הגישו', count: n(stuck.opened_not_submitted), href: `${projectPath}?tab=joining&view=invitations&stuck=opened_not_submitted`, hint: 'נכנסו לעמוד דרך הקישור האישי ולא השאירו טופס.' },
      { key: 'submitted_not_signed', label: 'הגישו ולא חתמו', count: n(stuck.submitted_not_signed), href: `${projectPath}?tab=joining&view=registrations&status=pending`, hint: 'הטופס הוגש, ההסכם עדיין לא נחתם.' },
      { key: 'reminded_not_signed', label: 'קיבלו תזכורת ולא חתמו', count: n(stuck.reminded_not_signed), href: `${projectPath}?tab=joining&view=invitations&stuck=reminded_not_signed`, hint: 'נשלחה לפחות תזכורת אחת, ואין חתימה.' },
      { key: 'failed', label: 'תהליך שנכשל', count: n(stuck.failed), href: `${projectPath}?tab=joining&view=all&status=failed`, hint: 'ההרשמה נעצרה בשגיאה.' },
    ].filter((card) => card.count > 0),
  }
}
