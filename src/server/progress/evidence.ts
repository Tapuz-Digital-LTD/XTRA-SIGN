import { inArray, sql } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import type { ProgressEvidence } from '@/lib/joining-progress'

/**
 * The rows that prove where a signer got to, for many people at once.
 *
 * Every field is a timestamp of something that actually happened: a send the
 * provider accepted, a code request, a verified phone, an opened page, a
 * signature. Nothing here is derived from a status name, so a screen can say
 * "קוד אומת" only when `recipients.verified_at` exists.
 *
 * Delivery to a handset is deliberately absent: no provider receipt reaches
 * this system, so "נשלח" is the strongest word any screen may use.
 */
export type AgreementEvidence = Pick<ProgressEvidence, 'agreementCreatedAt' | 'linkSentAt' | 'linkSendFailedAt' | 'codeSentAt' | 'codeVerifiedAt' | 'linkOpenedAt' | 'signedAt' | 'agreementStatus'>

const LINK_EVENTS = sql`('invitation', 'reminder', 'registration_completed')`
const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : typeof v === 'string' ? new Date(v).toISOString() : null)

/** Evidence per agreement id. Missing ids simply have no entry. */
export async function agreementEvidence(agreementIds: string[]): Promise<Map<string, AgreementEvidence>> {
  const ids = [...new Set(agreementIds.filter(Boolean))]
  const out = new Map<string, AgreementEvidence>()
  if (ids.length === 0) return out
  const rows = await getDb().execute(sql`
    select a.id,
      a.status,
      a.created_at as agreement_created_at,
      a.completed_at as signed_at,
      r.verified_at as code_verified_at,
      (select max(e.created_at) from ${schema.auditEvents} e where e.agreement_id = a.id and e.type = 'otp_sent') as code_sent_at,
      (select max(e.created_at) from ${schema.auditEvents} e where e.agreement_id = a.id and e.type = 'viewed') as link_opened_at,
      (select max(m.sent_at) from ${schema.messageSends} m where m.agreement_id = a.id and m.ok and m.is_test = false and m.event in ${LINK_EVENTS}) as link_sent_at,
      (select max(m.sent_at) from ${schema.messageSends} m where m.agreement_id = a.id and m.ok = false and m.is_test = false and m.event in ${LINK_EVENTS}) as link_send_failed_at,
      (select max(d.sent_at) from ${schema.deliveries} d where d.agreement_id = a.id and d.status = 'sent') as delivery_sent_at
    from ${schema.agreements} a
    left join ${schema.recipients} r on r.agreement_id = a.id
    where a.id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)})`)
  for (const row of rows.rows as Record<string, unknown>[]) {
    out.set(row.id as string, {
      agreementStatus: (row.status as string) ?? null,
      agreementCreatedAt: iso(row.agreement_created_at),
      // A send the provider accepted, from either record of it.
      linkSentAt: iso(row.link_sent_at) ?? iso(row.delivery_sent_at),
      linkSendFailedAt: iso(row.link_send_failed_at),
      codeSentAt: iso(row.code_sent_at),
      codeVerifiedAt: iso(row.code_verified_at),
      linkOpenedAt: iso(row.link_opened_at),
      signedAt: iso(row.signed_at),
    })
  }
  return out
}

/** The last accepted / refused invitation send per lead, for people with no agreement yet. */
export async function leadSendEvidence(leadIds: string[]): Promise<Map<string, { linkSentAt: string | null; linkSendFailedAt: string | null }>> {
  const ids = [...new Set(leadIds.filter(Boolean))]
  const out = new Map<string, { linkSentAt: string | null; linkSendFailedAt: string | null }>()
  if (ids.length === 0) return out
  const rows = await getDb()
    .select({ leadId: schema.messageSends.leadId, ok: schema.messageSends.ok, sentAt: schema.messageSends.sentAt })
    .from(schema.messageSends)
    .where(sql`${inArray(schema.messageSends.leadId, ids)} and ${schema.messageSends.isTest} = false`)
  for (const row of rows) {
    if (!row.leadId) continue
    const current = out.get(row.leadId) ?? { linkSentAt: null, linkSendFailedAt: null }
    const at = row.sentAt.toISOString()
    if (row.ok) current.linkSentAt = !current.linkSentAt || at > current.linkSentAt ? at : current.linkSentAt
    else current.linkSendFailedAt = !current.linkSendFailedAt || at > current.linkSendFailedAt ? at : current.linkSendFailedAt
    out.set(row.leadId, current)
  }
  return out
}

/**
 * Where the newest joining process of one company stands — for the company
 * card, so a person opening a supplier sees the same sentence the campaign
 * screens show, not a different one.
 */
export async function companyJoiningProgress(organizationId: string, companyId: string) {
  const [lead] = await getDb()
    .select({ id: schema.projectLeads.id, groupId: schema.projectLeads.groupId, groupName: schema.groups.name, createdAt: schema.projectLeads.createdAt, status: schema.projectLeads.status, invitedBy: schema.projectLeads.invitedBy, formSnapshot: schema.projectLeads.formSnapshot, agreementId: schema.projectLeads.agreementId })
    .from(schema.projectLeads)
    .innerJoin(schema.groups, sql`${schema.groups.id} = ${schema.projectLeads.groupId}`)
    .where(sql`${schema.projectLeads.organizationId} = ${organizationId} and ${schema.projectLeads.companyId} = ${companyId} and ${schema.projectLeads.status} <> 'pending' and ${schema.groups.systemKey} is null`)
    .orderBy(sql`${schema.projectLeads.createdAt} desc`)
    .limit(1)
  if (!lead) return null
  const [evidence, sends] = await Promise.all([lead.agreementId ? agreementEvidence([lead.agreementId]) : null, lead.agreementId ? null : leadSendEvidence([lead.id])])
  const { joiningProgress } = await import('@/lib/joining-progress')
  return {
    leadId: lead.id,
    groupId: lead.groupId,
    groupName: lead.groupName,
    progress: joiningProgress({
      invitedAt: lead.invitedBy ? lead.createdAt.toISOString() : null,
      submittedAt: lead.formSnapshot ? lead.createdAt.toISOString() : null,
      leadStatus: lead.status,
      ...(lead.agreementId ? (evidence?.get(lead.agreementId) ?? {}) : { agreementStatus: null, ...(sends?.get(lead.id) ?? {}) }),
    }),
  }
}
