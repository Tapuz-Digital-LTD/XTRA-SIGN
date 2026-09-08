import { sql, type SQL } from 'drizzle-orm'
import type { FieldMeta, FieldType, ReportEntity } from './types'

/**
 * The allowlist behind the report builder.
 *
 * Every entity says what a row is (one supplier, one person, one agreement…)
 * and lists its fields with the SQL that reads each one. Relations that would
 * multiply rows (a supplier's many agreements, tasks, registrations) are read
 * through `lateral (… limit 1)` — the newest one, inside the campaign scope
 * when the report filters by campaign — so a supplier is always one row.
 *
 * Nothing from the browser reaches SQL except as a bound parameter; a field
 * key or an operator outside this file is refused by the engine.
 */

export type FieldDef = FieldMeta & {
  /** How to read the value. Aliases: c companies, pl project_leads, a agreements, t follow_up_tasks, ms message_sends, g groups. */
  expr: SQL
  /** A custom filter for relation fields (tags, campaign) — receives the values. */
  relFilter?: (op: string, values: string[]) => SQL
  /** Enum labels, for the table and the file. */
  labels?: Record<string, string>
}

export type EntityDef = {
  /** FROM … JOIN …, given the campaign ids the report is scoped to (null = all). */
  from: (scope: string[] | null) => SQL
  /** Rows of this organisation only, plus the entity's own rules (no deleted, no test). */
  where: (organizationId: string) => SQL
  id: SQL
  links: Record<'company' | 'agreement' | 'lead' | 'group' | 'task', SQL | null>
  fields: FieldDef[]
  /** The field whose `one_of` values scope the lateral relations. */
  campaignField: string | null
}

const AGREEMENT_STATUS: Record<string, string> = { draft: 'טיוטה', sent: 'ממתין לחתימה', viewed: 'ממתין לחתימה', signed: 'נחתם', expired: 'פג תוקף', canceled: 'בוטל', declined: 'סורב' }
const PROCESS: Record<string, string> = { invited: 'הוזמן', registered: 'נרשם', awaiting_signature: 'ממתין לחתימה', signed: 'חתם', failed: 'נכשל' }
const TASK: Record<string, string> = { pending: 'ממתין להקמה', in_progress: 'בטיפול', done: 'הוקם באתר', not_needed: 'לא נדרש' }
const SOURCE: Record<string, string> = { xtra: 'XTRA Sign', crm: 'CRM' }
const CHANNEL: Record<string, string> = { sms: 'SMS', email: 'אימייל', whatsapp: 'WhatsApp' }
const EVENT: Record<string, string> = { invitation: 'הזמנה', reminder: 'תזכורת', signed_confirmation: 'עותק חתום', registration_completed: 'קישור לחתימה', distribution: 'הפצה' }
const KIND: Record<string, string> = { supplier: 'ספק', customer: 'לקוח' }
/** The proven steps, in the words the screens use. */
const STAGE: Record<string, string> = {
  invited: 'הוזמן, טרם נרשם',
  registered: 'הפרטים התקבלו',
  agreement_created: 'ההסכם נוצר',
  link_sent: 'קישור לחתימה נשלח',
  code_sent: 'קוד אימות נשלח',
  link_opened: 'הקישור נפתח',
  code_verified: 'קוד האימות אומת',
  signed: 'החתימה הושלמה',
  expired: 'פג תוקף',
  closed: 'בוטל או סורב',
  failed: 'ההרשמה נכשלה',
}
const CALL: Record<string, string> = { interested: 'מעוניין', call_back: 'לחזור אליו', no_answer: 'לא ענה', not_interested: 'לא מעוניין' }
const SEND_RESULT: Record<string, string> = { sent: 'נשלח', failed: 'נכשל', opened: 'WhatsApp נפתח, לא אושר', not_sent: 'WhatsApp — לא נשלח', reserved: 'בתהליך' }
const YES_NO: Record<string, string> = { true: 'כן', false: 'לא' }


/**
 * A JS array as ONE bound parameter in Postgres array syntax: the template
 * would otherwise spread it into a list, which is not an array. Values are
 * quoted, so a stray comma or brace in a name cannot change the shape.
 */
export function pgArray(values: readonly string[]): string {
  return `{${values.map((v) => `"${String(v).replace(/[\\"]/g, (c) => `\\${c}`)}"`).join(',')}}`
}

const opts = (m: Record<string, string>) => Object.entries(m).map(([value, label]) => ({ value, label }))

function f(key: string, label: string, type: FieldType, expr: SQL, extra: Partial<FieldDef> = {}): FieldDef {
  return { key, label, type, expr, defaultVisible: false, filterable: true, sortable: type !== 'tags', group: 'פרטים', ...extra }
}

/** `a` is inside the campaign scope: through a registration or a bulk send. */
const agreementInScope = (aAlias: string, scope: string[]) =>
  sql`(exists (select 1 from project_leads spl where spl.agreement_id = ${sql.raw(aAlias)}.id and spl.group_id::text = any(${pgArray(scope)}::text[]))
    or exists (select 1 from bulk_batch_items sbi join bulk_batches sbb on sbb.id = sbi.batch_id where sbi.agreement_id = ${sql.raw(aAlias)}.id and sbb.group_id::text = any(${pgArray(scope)}::text[])))`

/** The campaign an agreement belongs to: its registration's, else its bulk send's. */
const agreementGroup = (aAlias: string) =>
  sql`coalesce((select spl.group_id from project_leads spl where spl.agreement_id = ${sql.raw(aAlias)}.id limit 1), (select sbb.group_id from bulk_batch_items sbi join bulk_batches sbb on sbb.id = sbi.batch_id where sbi.agreement_id = ${sql.raw(aAlias)}.id limit 1))`

const groupName = (gAlias: string) => sql`case when ${sql.raw(gAlias)}.system_key = 'direct_signing' then 'חתימה ישירה' else ${sql.raw(gAlias)}.name end`

/** The same rules as the agreements screen's "דורשים טיפול" (src/server/documents/queries.ts), as one boolean. */
const attentionSql = (a: string) => sql`(
  ${sql.raw(a)}.status <> 'canceled' and (
    exists (select 1 from message_sends ms0 where ms0.agreement_id = ${sql.raw(a)}.id and ms0.ok = false and ms0.is_test = false and ms0.resolved_at is null
      and (ms0.error is distinct from 'reserved' or ms0.sent_at < now() - interval '10 minutes')
      and (ms0.channel <> 'whatsapp' or ms0.manual_state = 'not_sent')
      and (ms0.event not in ('invitation', 'reminder', 'registration_completed') or ${sql.raw(a)}.status in ('sent', 'viewed'))
      and not exists (select 1 from message_sends later where later.agreement_id = ms0.agreement_id and later.event = ms0.event and later.channel = ms0.channel and later.ok = true and later.sent_at > ms0.sent_at))
    or (${sql.raw(a)}.status in ('sent', 'viewed') and ${sql.raw(a)}.expires_at is not null and ${sql.raw(a)}.expires_at < now())
    or (${sql.raw(a)}.company_id is null and not exists (select 1 from project_leads tpl where tpl.agreement_id = ${sql.raw(a)}.id))
    or (${sql.raw(a)}.status = 'viewed' and ${sql.raw(a)}.sent_at < now() - interval '3 days' and (${sql.raw(a)}.expires_at is null or ${sql.raw(a)}.expires_at >= now())
      and not exists (select 1 from audit_events ae where ae.agreement_id = ${sql.raw(a)}.id and ae.type = 'reminder_sent' and ae.created_at > now() - interval '3 days'))
  ))`

const companyTags = (cAlias: string) => sql`(select array_agg(tg.name order by tg.name) from company_tags ct join tags tg on tg.id = ct.tag_id where ct.company_id = ${sql.raw(cAlias)}.id)`
const tagRel = (idExpr: SQL, table: 'company_tags' | 'lead_tags', col: 'company_id' | 'lead_id') => (op: string, values: string[]) => {
  const one = sql`exists (select 1 from ${sql.raw(table)} x where x.${sql.raw(col)} = ${idExpr} and x.tag_id::text = any(${pgArray(values)}::text[]))`
  if (op === 'contains_any') return one
  if (op === 'not_contains') return sql`not ${one}`
  if (op === 'contains_all') return sql`(select count(distinct x.tag_id) from ${sql.raw(table)} x where x.${sql.raw(col)} = ${idExpr} and x.tag_id::text = any(${pgArray(values)}::text[])) = ${values.length}`
  return one
}

function companyEntity(kind: 'supplier' | 'customer'): EntityDef {
  const scoped = (scope: string[] | null, a: string) => (scope ? sql`and ${agreementInScope(a, scope)}` : sql``)
  return {
    campaignField: 'campaigns',
    from: (scope) => sql`companies c
      left join lateral (select a.id, a.status, a.completed_at, a.sent_at from agreements a where a.company_id = c.id and a.deleted_at is null ${scoped(scope, 'a')} order by (a.status = 'signed') desc, a.completed_at desc nulls last, a.created_at desc limit 1) la on true
      left join lateral (select pl.id, pl.group_id, pl.assignee_user_id, pl.follow_up_at, pl.call_outcome, pl.internal_note, pl.created_at from project_leads pl where pl.company_id = c.id and pl.status <> 'pending' ${scope ? sql`and pl.group_id::text = any(${pgArray(scope)}::text[])` : sql``} order by pl.created_at desc limit 1) ll on true
      left join lateral (select t.id, t.status, t.link, t.due_at, t.assignee_user_id from follow_up_tasks t where t.company_id = c.id ${scope ? sql`and t.group_id::text = any(${pgArray(scope)}::text[])` : sql``} order by t.created_at desc limit 1) lt on true
      left join users ua on ua.id = coalesce(lt.assignee_user_id, ll.assignee_user_id)`,
    where: (org) => sql`c.organization_id = ${org} and c.deleted_at is null and c.archived_at is null and c.kind = ${kind}`,
    id: sql`c.id`,
    links: { company: sql`c.id`, agreement: sql`la.id`, lead: sql`ll.id`, group: sql`ll.group_id`, task: sql`lt.id` },
    fields: [
      f('name', 'שם העסק', 'text', sql`c.name`, { defaultVisible: true }),
      f('tax_id', 'ח.פ. / ע.מ.', 'text', sql`c.tax_id`, { defaultVisible: true }),
      f('contact_name', 'איש קשר', 'text', sql`c.contact_name`, { defaultVisible: true }),
      f('contact_phone', 'טלפון', 'text', sql`c.contact_phone`, { defaultVisible: true }),
      f('contact_email', 'אימייל', 'text', sql`c.contact_email`),
      f('data_source', 'מקור נתונים', 'enum', sql`case when c.crm_record_id is null then 'xtra' else 'crm' end`, { options: opts(SOURCE), labels: SOURCE, defaultVisible: true }),
      f('campaigns', 'קמפיינים', 'campaign', sql`(select array_agg(g.name order by g.name) from company_groups cg join groups g on g.id = cg.group_id where cg.company_id = c.id and g.deleted_at is null)`, {
        sortable: false,
        group: 'קמפיין',
        relFilter: (op, values) => {
          const inCampaign = sql`(exists (select 1 from company_groups cg where cg.company_id = c.id and cg.group_id::text = any(${pgArray(values)}::text[])) or exists (select 1 from project_leads xpl where xpl.company_id = c.id and xpl.group_id::text = any(${pgArray(values)}::text[])))`
          return op === 'not_one_of' ? sql`not ${inCampaign}` : inCampaign
        },
      }),
      f('tags', 'תגים', 'tags', companyTags('c'), { relFilter: tagRel(sql`c.id`, 'company_tags', 'company_id'), defaultVisible: true }),
      f('created_at', 'נוצר', 'date', sql`c.created_at`, { group: 'תאריכים' }),
      f('registered_at', 'תאריך הרשמה', 'date', sql`ll.created_at`, { group: 'תאריכים' }),
      f('signature_status', 'סטטוס חתימה', 'enum', sql`la.status`, { options: opts(AGREEMENT_STATUS), labels: AGREEMENT_STATUS, defaultVisible: true, group: 'הסכם' }),
      f('signed_at', 'מועד חתימה', 'date', sql`la.completed_at`, { group: 'הסכם', defaultVisible: true }),
      f('sent_at', 'נשלח לחתימה', 'date', sql`la.sent_at`, { group: 'הסכם' }),
      f('task_status', 'סטטוס הקמה', 'enum', sql`lt.status`, { options: opts(TASK), labels: TASK, group: 'משימת המשך', defaultVisible: true }),
      f('task_link', 'קישור למוצר', 'text', sql`lt.link`, { group: 'משימת המשך' }),
      f('task_due_at', 'תאריך יעד', 'date', sql`lt.due_at`, { group: 'משימת המשך' }),
      f('assignee', 'אחראי', 'user', sql`coalesce(lt.assignee_user_id, ll.assignee_user_id)::text`, { group: 'מעקב' }),
      f('assignee_name', 'שם האחראי', 'text', sql`ua.name`, { group: 'מעקב', filterable: false }),
      f('follow_up_at', 'תאריך חזרה', 'date', sql`ll.follow_up_at`, { group: 'מעקב' }),
      f('call_outcome', 'תוצאת שיחה', 'enum', sql`ll.call_outcome`, { options: opts(CALL), labels: CALL, group: 'מעקב' }),
      f('notes', 'הערות', 'text', sql`c.notes`, { sortable: false }),
    ],
  }
}

const people: EntityDef = {
  campaignField: 'campaign',
  from: () => sql`project_leads pl
    left join agreements a on a.id = pl.agreement_id
    left join lateral (select r0.verified_at from recipients r0 where r0.agreement_id = a.id order by r0.id limit 1) r on true
    left join companies co on co.id = pl.company_id
    left join groups g on g.id = pl.group_id
    left join users ui on ui.id = pl.invited_by
    left join users ua on ua.id = pl.assignee_user_id
    left join lateral (select t.id, t.status, t.link from follow_up_tasks t where t.lead_id = pl.id order by t.created_at desc limit 1) lt on true`,
  where: (org) => sql`pl.organization_id = ${org} and pl.status <> 'pending' and g.deleted_at is null`,
  id: sql`pl.id`,
  links: { company: sql`pl.company_id`, agreement: sql`pl.agreement_id`, lead: sql`pl.id`, group: sql`pl.group_id`, task: sql`lt.id` },
  fields: [
    f('name', 'שם', 'text', sql`coalesce(nullif(pl.data->>'name', ''), nullif(pl.data->>'businessName', ''), co.name)`, { defaultVisible: true }),
    f('phone', 'טלפון', 'text', sql`coalesce(pl.phone, pl.data->>'phone')`, { defaultVisible: true }),
    f('email', 'אימייל', 'text', sql`coalesce(pl.email, pl.data->>'email')`),
    f('kind', 'ספק/לקוח', 'enum', sql`coalesce(pl.kind, g.kind)`, { options: opts(KIND), labels: KIND }),
    f('campaign', 'קמפיין', 'campaign', groupName('g'), { defaultVisible: true, group: 'קמפיין', relFilter: (op, values) => (op === 'not_one_of' ? sql`not (pl.group_id::text = any(${pgArray(values)}::text[]))` : sql`pl.group_id::text = any(${pgArray(values)}::text[])`) }),
    f(
      'process_status',
      'סטטוס בתהליך',
      'enum',
      sql`case when a.status = 'signed' then 'signed' when a.status in ('sent','viewed','expired') then 'awaiting_signature' when pl.status = 'invited' then 'invited' when pl.status in ('failed','rejected') or a.status in ('canceled','declined') then 'failed' else 'registered' end`,
      { options: opts(PROCESS), labels: PROCESS, defaultVisible: true },
    ),
    f('agreement_status', 'סטטוס הסכם', 'enum', sql`a.status`, { options: opts(AGREEMENT_STATUS), labels: AGREEMENT_STATUS, group: 'הסכם' }),
    f('signed_at', 'מועד חתימה', 'date', sql`a.completed_at`, { group: 'הסכם' }),
    f('invite_channel', 'ערוץ הזמנה', 'enum', sql`pl.invite_channel`, { options: opts(CHANNEL), labels: CHANNEL, group: 'שליחה' }),
    f('invited_by', 'נציג ששלח', 'user', sql`pl.invited_by::text`, { group: 'שליחה' }),
    f('invited_by_name', 'שם הנציג', 'text', sql`ui.name`, { group: 'שליחה', filterable: false, defaultVisible: true }),
    f('assignee', 'אחראי', 'user', sql`pl.assignee_user_id::text`, { group: 'מעקב' }),
    f('assignee_name', 'שם האחראי', 'text', sql`ua.name`, { group: 'מעקב', filterable: false }),
    f('follow_up_at', 'תאריך חזרה', 'date', sql`pl.follow_up_at`, { group: 'מעקב' }),
    f('call_outcome', 'תוצאת שיחה', 'enum', sql`pl.call_outcome`, { options: opts(CALL), labels: CALL, group: 'מעקב' }),
    f('internal_note', 'הערה פנימית', 'text', sql`pl.internal_note`, { group: 'מעקב', sortable: false }),
    f('data_source', 'מקור נתונים', 'enum', sql`case when co.id is null then null when co.crm_record_id is null then 'xtra' else 'crm' end`, { options: opts(SOURCE), labels: SOURCE }),
    f('tags', 'תגים', 'tags', sql`(select array_agg(x.name order by x.name) from (select tg.name from lead_tags ltg join tags tg on tg.id = ltg.tag_id where ltg.lead_id = pl.id union select tg.name from company_tags ct join tags tg on tg.id = ct.tag_id where ct.company_id = pl.company_id) x)`, {
      relFilter: (op, values) => {
        const rel = sql`(exists (select 1 from lead_tags x where x.lead_id = pl.id and x.tag_id::text = any(${pgArray(values)}::text[])) or exists (select 1 from company_tags x where x.company_id = pl.company_id and x.tag_id::text = any(${pgArray(values)}::text[])))`
        return op === 'not_contains' ? sql`not ${rel}` : rel
      },
    }),
    f('source', 'מקור הגעה', 'text', sql`case when pl.invited_by is not null or pl.source = 'invitation' then 'הזמנה אישית' else 'הצטרף באתר' || coalesce(' · ' || nullif(coalesce(pl.meta->'attribution'->'last'->'source'->>'label', pl.meta->>'utm_source'), 'ישירות'), '') end`, { group: 'קמפיין' }),
    // The same test "הזמנות ומעקב" applies on screen, as a field rather than a
    // match on the sentence above it — so a filter and an export can say
    // "our own outreach" without depending on how it is worded.
    f('invited_by_us', 'הזמנה שלנו', 'boolean', sql`(pl.invited_by is not null or pl.source = 'invitation')`, { labels: YES_NO, group: 'קמפיין', sortable: false }),
    f('task_status', 'סטטוס הקמה', 'enum', sql`lt.status`, { options: opts(TASK), labels: TASK, group: 'משימת המשך' }),
    f('task_link', 'קישור למוצר', 'text', sql`lt.link`, { group: 'משימת המשך' }),
    f('last_activity_at', 'פעילות אחרונה', 'date', sql`coalesce(pl.last_activity_at, pl.created_at)`, { defaultVisible: true, group: 'תאריכים' }),
    f('created_at', 'נוצר', 'date', sql`pl.created_at`, { group: 'תאריכים' }),
    f('submitted', 'מילא את הטופס', 'boolean', sql`(pl.form_snapshot is not null)`, { labels: YES_NO, sortable: false }),
    // The last step the database can prove — the same ladder the screens show.
    f('progress_stage', 'השלב שאומת', 'enum', sql`case
      when a.status = 'signed' then 'signed'
      when a.status = 'expired' then 'expired'
      when a.status in ('canceled','declined') then 'closed'
      when pl.status in ('failed','rejected') then 'failed'
      when a.id is null and pl.status = 'invited' then 'invited'
      when a.id is null then 'registered'
      when r.verified_at is not null then 'code_verified'
      when exists (select 1 from audit_events e where e.agreement_id = a.id and e.type = 'viewed') then 'link_opened'
      when exists (select 1 from audit_events e where e.agreement_id = a.id and e.type = 'otp_sent') then 'code_sent'
      when exists (select 1 from message_sends m where m.agreement_id = a.id and m.ok and m.is_test = false and m.event in ('invitation','reminder','registration_completed')) then 'link_sent'
      else 'agreement_created' end`, { options: opts(STAGE), labels: STAGE, group: 'התקדמות' }),
    f('link_sent_at', 'מועד שליחת הקישור', 'date', sql`(select max(m.sent_at) from message_sends m where m.agreement_id = a.id and m.ok and m.is_test = false and m.event in ('invitation','reminder','registration_completed'))`, { group: 'התקדמות' }),
    f('code_verified_at', 'מועד אימות הקוד', 'date', sql`r.verified_at`, { group: 'התקדמות' }),
    f('link_opened_at', 'מועד פתיחת ההסכם', 'date', sql`(select max(e.created_at) from audit_events e where e.agreement_id = a.id and e.type = 'viewed')`, { group: 'התקדמות' }),
  ],
}

const agreements: EntityDef = {
  campaignField: 'campaign',
  from: () => sql`agreements a
    left join companies co on co.id = a.company_id
    left join lateral (select r.name, r.phone, r.email from recipients r where r.agreement_id = a.id order by r.id limit 1) rc on true
    left join lateral (select g.id, g.name, g.system_key from groups g where g.id = ${agreementGroup('a')} limit 1) g on true
    left join users uo on uo.id = a.owner_id
    left join lateral (select t.id, t.status from follow_up_tasks t where t.agreement_id = a.id order by t.created_at desc limit 1) lt on true
    left join lateral (select ms.ok, ms.error, ms.channel, ms.manual_state from message_sends ms where ms.agreement_id = a.id and ms.is_test = false order by ms.sent_at desc limit 1) ls on true
    left join lateral (select spl.id from project_leads spl where spl.agreement_id = a.id limit 1) lpl on true`,
  where: (org) => sql`a.organization_id = ${org} and a.deleted_at is null`,
  id: sql`a.id`,
  links: { company: sql`a.company_id`, agreement: sql`a.id`, lead: sql`lpl.id`, group: sql`g.id`, task: sql`lt.id` },
  fields: [
    f('title', 'מסמך', 'text', sql`a.title`, { defaultVisible: true }),
    f('status', 'סטטוס חתימה', 'enum', sql`a.status`, { options: opts(AGREEMENT_STATUS), labels: AGREEMENT_STATUS, defaultVisible: true }),
    f('company', 'ספק/לקוח', 'text', sql`co.name`, { defaultVisible: true }),
    f('company_kind', 'סוג', 'enum', sql`co.kind`, { options: opts(KIND), labels: KIND }),
    f('data_source', 'מקור נתונים', 'enum', sql`case when co.id is null then null when co.crm_record_id is null then 'xtra' else 'crm' end`, { options: opts(SOURCE), labels: SOURCE }),
    f('recipient_name', 'חותם', 'text', sql`rc.name`, { defaultVisible: true, group: 'חותם' }),
    f('recipient_phone', 'טלפון החותם', 'text', sql`rc.phone`, { group: 'חותם' }),
    f('recipient_email', 'אימייל החותם', 'text', sql`rc.email`, { group: 'חותם' }),
    f('campaign', 'קמפיין', 'campaign', groupName('g'), { defaultVisible: true, group: 'קמפיין', relFilter: (op, values) => (op === 'not_one_of' ? sql`not (coalesce(g.id::text, '') = any(${pgArray(values)}::text[]))` : sql`coalesce(g.id::text, '') = any(${pgArray(values)}::text[])`) }),
    f('sent_at', 'נשלח', 'date', sql`a.sent_at`, { defaultVisible: true, group: 'תאריכים' }),
    f('completed_at', 'נחתם', 'date', sql`a.completed_at`, { group: 'תאריכים' }),
    f('expires_at', 'תוקף הקישור', 'date', sql`a.expires_at`, { group: 'תאריכים' }),
    f('created_at', 'נוצר', 'date', sql`a.created_at`, { group: 'תאריכים' }),
    f('owner', 'נשלח על ידי', 'user', sql`a.owner_id::text`, { group: 'שליחה' }),
    f('owner_name', 'שם השולח', 'text', sql`uo.name`, { group: 'שליחה', filterable: false }),
    f('last_send_result', 'שליחה אחרונה', 'enum', sql`case when ls.channel is null then null when ls.channel = 'whatsapp' then coalesce(ls.manual_state, 'opened') when ls.ok then 'sent' when ls.error = 'reserved' then 'reserved' else 'failed' end`, { options: opts(SEND_RESULT), labels: SEND_RESULT, group: 'שליחה', defaultVisible: true }),
    f('task_status', 'סטטוס הקמה', 'enum', sql`lt.status`, { options: opts(TASK), labels: TASK, group: 'משימת המשך' }),
    f('attention', 'דורש טיפול', 'boolean', attentionSql('a'), { labels: YES_NO, sortable: false }),
    f('attention_reason', 'מה דורש טיפול', 'text', sql`null`, { filterable: false, sortable: false }),
  ],
}

const tasks: EntityDef = {
  campaignField: 'campaign',
  from: () => sql`follow_up_tasks t
    left join companies co on co.id = t.company_id
    left join groups g on g.id = t.group_id
    left join agreements a on a.id = t.agreement_id
    left join project_leads pl on pl.id = t.lead_id
    left join users ua on ua.id = t.assignee_user_id`,
  where: (org) => sql`t.organization_id = ${org}`,
  id: sql`t.id`,
  links: { company: sql`t.company_id`, agreement: sql`t.agreement_id`, lead: sql`t.lead_id`, group: sql`t.group_id`, task: sql`t.id` },
  fields: [
    f('kind', 'משימה', 'enum', sql`t.kind`, { options: [{ value: 'site_product', label: 'הקמת מוצר באתר' }], labels: { site_product: 'הקמת מוצר באתר' }, defaultVisible: true }),
    f('status', 'סטטוס', 'enum', sql`t.status`, { options: opts(TASK), labels: TASK, defaultVisible: true }),
    f('company', 'ספק/לקוח', 'text', sql`coalesce(co.name, pl.data->>'name', pl.data->>'businessName')`, { defaultVisible: true }),
    f('contact_name', 'איש קשר', 'text', sql`coalesce(co.contact_name, pl.data->>'contactName')`),
    f('contact_phone', 'טלפון', 'text', sql`coalesce(co.contact_phone, pl.phone, pl.data->>'phone')`),
    f('campaign', 'קמפיין', 'campaign', groupName('g'), { defaultVisible: true, group: 'קמפיין', relFilter: (op, values) => (op === 'not_one_of' ? sql`not (t.group_id::text = any(${pgArray(values)}::text[]))` : sql`t.group_id::text = any(${pgArray(values)}::text[])`) }),
    f('assignee', 'אחראי', 'user', sql`t.assignee_user_id::text`, { group: 'מעקב' }),
    f('assignee_name', 'שם האחראי', 'text', sql`ua.name`, { group: 'מעקב', filterable: false, defaultVisible: true }),
    f('due_at', 'תאריך יעד', 'date', sql`t.due_at`, { defaultVisible: true, group: 'תאריכים' }),
    f('signed_at', 'מועד חתימה', 'date', sql`a.completed_at`, { group: 'תאריכים' }),
    f('created_at', 'נוצר', 'date', sql`t.created_at`, { group: 'תאריכים' }),
    f('completed_at', 'הושלם', 'date', sql`t.completed_at`, { group: 'תאריכים' }),
    f('note', 'הערה', 'text', sql`t.note`, { sortable: false }),
    f('link', 'קישור למוצר', 'text', sql`t.link`),
  ],
}

const sends: EntityDef = {
  campaignField: 'campaign',
  from: () => sql`message_sends ms
    left join groups g on g.id = ms.group_id
    left join project_leads pl on pl.id = ms.lead_id
    left join agreements a on a.id = ms.agreement_id
    left join lateral (select r.name from recipients r where r.agreement_id = ms.agreement_id order by r.id limit 1) rc on true
    left join users us on us.id = ms.sent_by`,
  where: (org) => sql`ms.organization_id = ${org} and ms.is_test = false`,
  id: sql`ms.id`,
  links: { company: sql`pl.company_id`, agreement: sql`ms.agreement_id`, lead: sql`ms.lead_id`, group: sql`ms.group_id`, task: null },
  fields: [
    f('sent_at', 'מועד', 'date', sql`ms.sent_at`, { defaultVisible: true, group: 'תאריכים' }),
    f('person', 'למי', 'text', sql`coalesce(pl.data->>'name', pl.data->>'businessName', rc.name)`, { defaultVisible: true }),
    f('recipient', 'כתובת/מספר', 'text', sql`ms.recipient`, { defaultVisible: true }),
    f('channel', 'ערוץ', 'enum', sql`ms.channel`, { options: opts(CHANNEL), labels: CHANNEL, defaultVisible: true }),
    f('event', 'סוג הודעה', 'enum', sql`ms.event`, { options: opts(EVENT), labels: EVENT, defaultVisible: true }),
    f('result', 'תוצאה', 'enum', sql`case when ms.channel = 'whatsapp' then coalesce(ms.manual_state, 'opened') when ms.ok then 'sent' when ms.error = 'reserved' then 'reserved' else 'failed' end`, { options: opts(SEND_RESULT), labels: SEND_RESULT, defaultVisible: true }),
    f('error', 'סיבת הכשל', 'text', sql`case when ms.ok or ms.error in ('reserved', 'abandoned') then null else ms.error end`, { sortable: false }),
    f('campaign', 'קמפיין', 'campaign', groupName('g'), { group: 'קמפיין', relFilter: (op, values) => (op === 'not_one_of' ? sql`not (coalesce(ms.group_id::text, '') = any(${pgArray(values)}::text[]))` : sql`coalesce(ms.group_id::text, '') = any(${pgArray(values)}::text[])`) }),
    f('sent_by', 'נציג', 'user', sql`ms.sent_by::text`, { group: 'שליחה' }),
    f('sent_by_name', 'שם הנציג', 'text', sql`us.name`, { group: 'שליחה', filterable: false }),
    f('agreement_title', 'מסמך', 'text', sql`a.title`, { group: 'הסכם' }),
  ],
}

export const ENTITIES: Record<ReportEntity, EntityDef> = {
  suppliers: companyEntity('supplier'),
  customers: companyEntity('customer'),
  people,
  agreements,
  tasks,
  sends,
}

export function fieldMeta(def: FieldDef): FieldMeta {
  const { key, label, type, options, defaultVisible, filterable, sortable, group, campaignsNote } = def
  return { key, label, type, options, defaultVisible, filterable, sortable, group, ...(campaignsNote ? { campaignsNote } : {}) }
}

/** A custom form field as a report field: `form.<id>` reads the registration's answer. */
export function formField(id: string, label: string, note: string): FieldDef {
  const safe = id.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 60)
  return f(`form.${safe}`, `טופס: ${label}`, 'text', sql`pl.data->>${safe}`, { group: 'שדות טופס', campaignsNote: note, sortable: false })
}
