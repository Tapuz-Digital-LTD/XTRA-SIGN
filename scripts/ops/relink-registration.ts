import { and, eq } from 'drizzle-orm'
import { getDb, schema } from '../../src/server/db'

/**
 * Moves one registration (and its agreement and campaign membership) from
 * the company it was wrongly matched to — a CRM-mirrored one — onto a new
 * XTRA Sign company built from the registration's own snapshot. Nothing
 * signed changes: the agreement keeps its id, versions, PDF and audit; only
 * its company pointer moves. The CRM company is left untouched. One admin
 * audit line records the move.
 *
 *   LEAD_ID=<uuid> npx dotenv-cli -e <env> -- npx tsx scripts/ops/relink-registration.ts [--apply]
 */
const LEAD_ID = process.env.LEAD_ID ?? ''
const apply = process.argv.includes('--apply')
const actor = process.env.CLEANUP_ACTOR ?? 'ops-script'
if (!LEAD_ID) throw new Error('LEAD_ID required')

async function main() {
  const db = getDb()
  const [lead] = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.id, LEAD_ID)).limit(1)
  if (!lead) throw new Error('lead not found')
  const [group] = await db.select({ id: schema.groups.id, organizationId: schema.groups.organizationId, kind: schema.groups.kind, name: schema.groups.name }).from(schema.groups).where(eq(schema.groups.id, lead.groupId)).limit(1)
  if (!group) throw new Error('group not found')
  const [wrong] = lead.companyId ? await db.select({ id: schema.companies.id, name: schema.companies.name, crm: schema.companies.crmRecordId }).from(schema.companies).where(eq(schema.companies.id, lead.companyId)).limit(1) : []
  const data = (lead.data ?? {}) as Record<string, string>
  const name = (data.businessName || data.name || data.signatoryName || 'נרשם ללא שם').trim()
  console.log(`lead ${lead.id} in "${group.name}" → currently on "${wrong?.name ?? '-'}" (crm-linked: ${Boolean(wrong?.crm)})`)
  console.log(`would create XTRA Sign ${group.kind ?? 'supplier'}: "${name}", tax ${data.taxId ?? '-'}, phone ${data.phone ? '…' + data.phone.slice(-4) : '-'}, email ${data.email ? data.email.slice(0, 2) + '***' : '-'}`)
  if (!apply) return console.log('dry run — pass --apply to move it')

  await db.transaction(async (tx) => {
    const [company] = await tx
      .insert(schema.companies)
      .values({ organizationId: group.organizationId, kind: (group.kind ?? 'supplier') as 'supplier' | 'customer', name, taxId: data.taxId ?? null, contactName: data.signatoryName ?? null, contactPhone: data.phone ?? null, contactEmail: data.email ?? null, source: 'xtra' })
      .returning({ id: schema.companies.id })
    await tx.update(schema.projectLeads).set({ companyId: company.id }).where(eq(schema.projectLeads.id, lead.id))
    if (lead.agreementId) await tx.update(schema.agreements).set({ companyId: company.id }).where(eq(schema.agreements.id, lead.agreementId))
    if (wrong) await tx.delete(schema.companyGroups).where(and(eq(schema.companyGroups.groupId, group.id), eq(schema.companyGroups.companyId, wrong.id)))
    await tx.insert(schema.companyGroups).values({ groupId: group.id, companyId: company.id }).onConflictDoNothing()
    await tx.insert(schema.adminAuditEvents).values({
      organizationId: group.organizationId,
      actorEmail: actor,
      type: 'registration_relinked',
      metadata: { leadId: lead.id, agreementId: lead.agreementId, from: wrong?.id ?? null, fromName: wrong?.name ?? null, to: company.id, toName: name, reason: 'campaign saves registrants in XTRA Sign; the earlier match reached a CRM-mirrored company' },
    })
    console.log(`moved to new company ${company.id}`)
  })
  process.exit(0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
