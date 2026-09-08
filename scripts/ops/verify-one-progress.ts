import { sql } from 'drizzle-orm'
import { getDb } from '@/server/db'
import { joiningProgress } from '@/lib/joining-progress'
import { agreementEvidence } from '@/server/progress/evidence'
import { isStaffInvitation } from '@/server/invitations/invitations'

/** READ-ONLY: what a worker will read for one production row, computed from its own rows. */
async function main() {
  const db = getDb()
  const [lead] = (await db.execute(sql`select id, status, source, invited_by, form_snapshot is not null as submitted, created_at, agreement_id, data->>'name' as name from project_leads where data->>'name' ilike '%ספר המדבר%' limit 1`)).rows as Record<string, unknown>[]
  const evidence = (await agreementEvidence([lead.agreement_id as string])).get(lead.agreement_id as string)!
  const p = joiningProgress({
    invitedAt: lead.invited_by ? new Date(lead.created_at as string).toISOString() : null,
    submittedAt: lead.submitted ? new Date(lead.created_at as string).toISOString() : null,
    leadStatus: lead.status as string,
    ...evidence,
  })
  console.log(`\n# ${lead.name}`)
  console.log(`staff invitation? ${isStaffInvitation({ invitedBy: lead.invited_by ? { id: String(lead.invited_by) } : null, source: lead.source as string })}  → appears in הזמנות ומעקב: ${isStaffInvitation({ invitedBy: lead.invited_by ? { id: String(lead.invited_by) } : null, source: lead.source as string })}`)
  console.log(`appears in הרשמות: ${Boolean(lead.submitted) && lead.status !== 'pending'}`)
  console.log(`\nכותרת:  ${p.headline}`)
  console.log(`הסבר:   ${p.explain}`)
  console.log(`שורה:   ${p.secondary}`)
  console.log(`הבא:    ${p.next}`)
  console.log('שלבים:')
  for (const s of p.steps) console.log(`  ${s.done ? '✓' : '○'} ${s.label}${s.done ? '' : ' — טרם'}${s.at ? ` (${new Date(s.at).toISOString().replace('T', ' ').slice(0, 16)}Z)` : ''}${s.note ? `  [${s.note}]` : ''}`)
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
