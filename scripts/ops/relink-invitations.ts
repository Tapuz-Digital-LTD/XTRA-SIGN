import { and, eq, isNull, sql } from 'drizzle-orm'
import { getDb, schema } from '../../src/server/db'

/**
 * Reunites a personal invitation with the registration it produced.
 *
 * Until the link carried the invitation's id all the way to the joining form,
 * a person who was invited and then signed ended up on two rows: the
 * invitation, left reading "הוזמן" forever, and a separate registration that
 * looked like someone who had found the campaign on their own. This repairs
 * the pairs that are beyond doubt and leaves everything else alone.
 *
 * What counts as beyond doubt, and nothing less:
 *   • both rows are in the same campaign;
 *   • the invitation was sent by a person, never converted, holds no form and
 *     no agreement — it is a stub, not a process;
 *   • exactly one registration in that campaign shares its normalised phone
 *     or email, and was created after it;
 *   • that registration is not already tied to an invitation.
 *
 * Names are never compared: two hotels share one. A pair with two candidates
 * is reported and skipped — a wrong merge is worse than a split row.
 *
 * The repair produces exactly what the fixed flow now produces: one row, the
 * invitation's, carrying the registration it turned into. The registration's
 * content moves onto the invitation row, everything that pointed at the
 * registration is re-pointed to it, and the emptied row goes. Signatures,
 * agreements and audit history are never touched — the agreement keeps its own
 * id and its own file throughout.
 *
 *   PROJECT_NAME='…' npx dotenv-cli -e <env> -- npx tsx scripts/ops/relink-invitations.ts
 *
 * Add APPLY=1 to write; without it nothing changes and the pairs are printed.
 */

const PROJECT_NAME = process.env.PROJECT_NAME ?? 'חודש התיירות הישראלית 2026'
const APPLY = process.env.APPLY === '1'

type Row = typeof schema.projectLeads.$inferSelect
const name = (r: Row) => String((r.data as Record<string, unknown> | null)?.name ?? (r.data as Record<string, unknown> | null)?.businessName ?? '—')
const short = (id: string) => id.slice(0, 8)

async function main() {
  const db = getDb()
  const [group] = await db
    .select()
    .from(schema.groups)
    .where(and(eq(schema.groups.name, PROJECT_NAME), isNull(schema.groups.deletedAt)))
    .limit(1)
  if (!group) throw new Error(`no campaign named ${PROJECT_NAME}`)

  const leads = await db.select().from(schema.projectLeads).where(eq(schema.projectLeads.groupId, group.id))

  /** A stub: invited by a person, never converted, nothing of its own. */
  const stubs = leads.filter((l) => l.invitedBy && l.status !== 'converted' && !l.agreementId && !l.formSnapshot)
  const pairs: { stub: Row; kept: Row; on: 'phone' | 'email' }[] = []
  const skipped: string[] = []

  for (const stub of stubs) {
    const matches = leads.filter(
      (l) =>
        l.id !== stub.id &&
        l.status === 'converted' &&
        !l.invitedBy &&
        !((l.meta as Record<string, unknown> | null)?.xs_inv) &&
        l.createdAt > stub.createdAt &&
        ((stub.phone && l.phone === stub.phone) || (stub.email && l.email === stub.email)),
    )
    if (matches.length === 0) continue
    if (matches.length > 1) {
      skipped.push(`${short(stub.id)} ${name(stub)} — ${matches.length} candidates, left alone`)
      continue
    }
    pairs.push({ stub, kept: matches[0], on: stub.phone && matches[0].phone === stub.phone ? 'phone' : 'email' })
  }

  console.log(`campaign: ${group.name}`)
  console.log(`leads: ${leads.length} · invitation stubs: ${stubs.length} · pairs beyond doubt: ${pairs.length}`)
  for (const { stub, kept, on } of pairs) {
    const gap = Math.round((kept.createdAt.getTime() - stub.createdAt.getTime()) / 60000)
    console.log(
      `\n  ${name(stub)}  (matched on ${on})` +
        `\n    invitation  ${short(stub.id)}  ${stub.createdAt.toISOString().slice(0, 16)}  status=${stub.status}` +
        `\n    signed row  ${short(kept.id)}  ${kept.createdAt.toISOString().slice(0, 16)}  status=${kept.status}  agreement=${kept.agreementId ? short(kept.agreementId) : '—'}  (+${gap} min)`,
    )
  }
  for (const s of skipped) console.log(`\n  skipped: ${s}`)

  if (!APPLY) {
    console.log(`\ndry run — add APPLY=1 to merge the ${pairs.length} pair(s) onto the invitation's own row`)
    return
  }

  for (const { stub, kept, on } of pairs) {
    await db.transaction(async (tx) => {
      // The key is unique per campaign, and for a moment both rows would hold
      // it; the row on its way out gives it up first.
      await tx.update(schema.projectLeads).set({ idempotencyKey: null }).where(eq(schema.projectLeads.id, kept.id))

      // The invitation row becomes the whole process, exactly as a claim does.
      await tx
        .update(schema.projectLeads)
        .set({
          status: kept.status,
          data: kept.data,
          formSnapshot: kept.formSnapshot,
          agreementId: kept.agreementId,
          companyId: kept.companyId,
          idempotencyKey: kept.idempotencyKey,
          kind: kept.kind ?? stub.kind,
          phone: kept.phone ?? stub.phone,
          email: kept.email ?? stub.email,
          ip: kept.ip,
          referrer: kept.referrer,
          lastActivityAt: kept.lastActivityAt ?? kept.createdAt,
          createdAt: kept.createdAt,
          meta: sql`coalesce(${schema.projectLeads.meta}, '{}'::jsonb) || coalesce(${JSON.stringify(kept.meta ?? {})}::jsonb, '{}'::jsonb) || ${JSON.stringify({ xs_inv: stub.id, invited_at: stub.createdAt.toISOString(), relinked_on: on })}::jsonb`,
        })
        .where(eq(schema.projectLeads.id, stub.id))

      // Everything that pointed at the row being retired now points at the one
      // that survives, so nothing is orphaned by the merge.
      await tx.update(schema.messageSends).set({ leadId: stub.id }).where(eq(schema.messageSends.leadId, kept.id))
      await tx.update(schema.campaignEvents).set({ registrationId: stub.id }).where(eq(schema.campaignEvents.registrationId, kept.id))
      await tx.update(schema.followUpTasks).set({ leadId: stub.id }).where(eq(schema.followUpTasks.leadId, kept.id))
      // Tags move by insert-then-drop: the pair may already share one, and the
      // primary key would refuse a plain re-point.
      await tx.execute(sql`insert into ${schema.leadTags} (lead_id, tag_id) select ${stub.id}, tag_id from ${schema.leadTags} where lead_id = ${kept.id} on conflict do nothing`)
      await tx.delete(schema.leadTags).where(eq(schema.leadTags.leadId, kept.id))

      await tx.delete(schema.projectLeads).where(eq(schema.projectLeads.id, kept.id))
      await tx.insert(schema.adminAuditEvents).values({
        organizationId: group.organizationId,
        actorEmail: 'ops:relink-invitations',
        type: 'lead_relinked',
        metadata: { campaign: group.id, keptLead: stub.id, mergedFrom: kept.id, matchedOn: on, agreement: kept.agreementId, invitedAt: stub.createdAt.toISOString(), name: name(stub) },
      })
    })
    console.log(`merged ${name(stub)}: ${short(kept.id)} → ${short(stub.id)} (the invitation's row survives)`)
  }

  console.log(`\n${pairs.length} invitation(s) reunited with the registration they produced`)
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error)
    process.exit(1)
  })
