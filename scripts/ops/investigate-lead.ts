import { sql } from 'drizzle-orm'
import { getDb } from '@/server/db'

/**
 * READ-ONLY. Every row that tells one registration's story, straight from
 * the tables (no UI labels): lead, company, group membership, agreement,
 * recipient, tokens, sessions, OTP challenges, audit, sends, deliveries,
 * funnel events, tasks, notifications, admin audit. Contact details, codes,
 * hashes and message bodies are masked before printing.
 *
 *   npx dotenv -e .env.production.pulled -- npx tsx scripts/ops/investigate-lead.ts "<name needle>"
 */
const NEEDLE = process.argv[2] ?? ''
const db = getDb()
const MASK = new Set(['phone', 'email', 'recipient', 'destination', 'contact_phone', 'contact_email', 'ip', 'user_agent', 'body', 'subject', 'token_hash', 'code_hash', 'session_hash', 'variables', 'provider_message_id', 'canvas_document', 'merge_snapshot', 'form_snapshot', 'referrer'])
const mask = (v: unknown): unknown => {
  if (v === null || v === undefined) return v
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length <= 4 ? '***' : `${s.slice(0, 2)}…${s.slice(-2)} (len ${s.length})`
}
function show(title: string, rows: Record<string, unknown>[]) {
  console.log(`\n## ${title} (${rows.length})`)
  for (const r of rows) {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(r)) {
      if (k === 'data' && v && typeof v === 'object') {
        out.data = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([dk, dv]) => [dk, ['phone', 'email'].includes(dk) ? mask(dv) : dv]))
      } else out[k] = MASK.has(k) ? mask(v) : v instanceof Date ? v.toISOString() : v
    }
    console.log(JSON.stringify(out))
  }
}
const rows = async (q: ReturnType<typeof sql>) => (await db.execute(q)).rows as Record<string, unknown>[]

async function main() {
  const leads = await rows(sql`select * from project_leads where data->>'name' ilike ${'%' + NEEDLE + '%'} or data->>'businessName' ilike ${'%' + NEEDLE + '%'} order by created_at desc limit 3`)
  show('project_leads', leads)
  for (const lead of leads) {
    const id = lead.id as string
    const groupId = lead.group_id as string
    const companyId = lead.company_id as string | null
    const agreementId = lead.agreement_id as string | null
    console.log(`\n=== lead ${id} ===`)
    if (companyId) {
      show('companies', await rows(sql`select id, organization_id, kind, name, tax_id, contact_name, contact_phone, contact_email, source, crm_record_id, crm_object_type, crm_synced_at, deleted_at, archived_at, created_at from companies where id = ${companyId}`))
      show('company_groups', await rows(sql`select * from company_groups where company_id = ${companyId}`))
      show('other agreements of this company', await rows(sql`select id, status, title, created_at, sent_at, completed_at, expires_at, supersedes_id, deleted_at from agreements where company_id = ${companyId} order by created_at`))
    }
    if (agreementId) {
      show('agreements', await rows(sql`select id, template_id, company_id, source_kind, title, status, owner_id, current_version_id, supersedes_id, created_at, sent_at, completed_at, archived_at, deleted_at, expires_at, merge_snapshot->'selfService' as self_service from agreements where id = ${agreementId}`))
      show('recipients', await rows(sql`select * from recipients where agreement_id = ${agreementId}`))
      show('signing_tokens', await rows(sql`select t.id, t.recipient_id, t.expires_at, t.revoked_at, t.created_at from signing_tokens t join recipients r on r.id = t.recipient_id where r.agreement_id = ${agreementId} order by t.created_at`))
      show('signing_sessions', await rows(sql`select s.id, s.recipient_id, s.signing_token_id, s.expires_at, s.created_at from signing_sessions s join recipients r on r.id = s.recipient_id where r.agreement_id = ${agreementId} order by s.created_at`))
      show('otp_challenges', await rows(sql`select o.id, o.recipient_id, o.destination, o.attempts, o.resend_count, o.last_sent_at, o.expires_at, o.consumed_at, o.created_at from otp_challenges o join recipients r on r.id = o.recipient_id where r.agreement_id = ${agreementId} order by o.created_at`))
      show('audit_events', await rows(sql`select id, recipient_id, type, actor, ip, user_agent, metadata, created_at from audit_events where agreement_id = ${agreementId} order by created_at`))
      show('deliveries', await rows(sql`select * from deliveries where agreement_id = ${agreementId} order by created_at`))
      show('signatures', await rows(sql`select s.* from signatures s join recipients r on r.id = s.recipient_id where r.agreement_id = ${agreementId}`))
      show('follow_up_tasks', await rows(sql`select * from follow_up_tasks where agreement_id = ${agreementId} or lead_id = ${id}`))
    }
    show('message_sends', await rows(sql`select id, group_id, agreement_id, lead_id, channel, event, recipient, subject, body, provider_message_id, is_test, ok, error, sent_at, sent_by, manual_state, retry_of, resolved_at, attempt_key from message_sends where lead_id = ${id} ${agreementId ? sql`or agreement_id = ${agreementId}` : sql``} order by sent_at`))
    show('campaign_events (by registration / agreement)', await rows(sql`select id, type, visit_id, requested_slug, canonical_slug, path, utm, referrer, registration_id, invitation_id, agreement_id, created_at from campaign_events where registration_id = ${id} ${agreementId ? sql`or agreement_id = ${agreementId}` : sql``} order by created_at`))
    const visits = await rows(sql`select distinct visit_id from campaign_events where registration_id = ${id} and visit_id is not null`)
    for (const v of visits) show(`campaign_events of visit ${v.visit_id}`, await rows(sql`select type, path, utm, referrer, registration_id, agreement_id, created_at from campaign_events where visit_id = ${v.visit_id as string} order by created_at`))
    show('notifications', await rows(sql`select id, type, title, link, created_at from notifications where link like ${'%' + (companyId ?? id) + '%'} or agreement_id = ${agreementId ?? '00000000-0000-0000-0000-000000000000'} order by created_at`))
    show('admin_audit_events mentioning ids', await rows(sql`select id, type, actor_email, target_email, metadata, created_at from admin_audit_events where metadata::text like ${'%' + id + '%'} ${agreementId ? sql`or metadata::text like ${'%' + agreementId + '%'}` : sql``} ${companyId ? sql`or metadata::text like ${'%' + companyId + '%'}` : sql``} order by created_at`))
    show('group', await rows(sql`select id, name, entry_method, goal, registration_target, follow_up_config, link_ttl_days, system_key, created_at from groups where id = ${groupId}`))
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
