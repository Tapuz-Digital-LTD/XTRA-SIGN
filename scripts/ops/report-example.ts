import { writeFileSync } from 'node:fs'
import { and, eq, ilike, isNull } from 'drizzle-orm'
import { getDb, schema } from '@/server/db'
import { buildReportWorkbook } from '@/server/reports/engine/export'
import { runReport } from '@/server/reports/engine/query'
import { TOURISM_EXAMPLE_COLUMNS } from '@/lib/report-presets'

/**
 * Read-only: the owner's binding example, run by the report engine against
 * whatever database the env points at. Prints the count and a masked sample,
 * and writes the .xlsx next to OUT. Nothing is written to the database.
 *
 *   OWNER=<staff email> OUT=/path/report.xlsx dotenv -e <env> -- tsx scripts/ops/report-example.ts
 */
const OWNER = process.env.OWNER ?? ''
const OUT = process.env.OUT ?? '/tmp/tourism-report.xlsx'
const CAMPAIGN = process.env.CAMPAIGN ?? 'התיירות'

async function main() {
  const db = getDb()
  const [user] = await db.select({ id: schema.users.id, organizationId: schema.users.organizationId, email: schema.users.email, name: schema.users.name, isAdmin: schema.users.isAdmin }).from(schema.users).where(eq(schema.users.email, OWNER)).limit(1)
  if (!user) throw new Error('owner user not found')
  const session = { userId: user.id, organizationId: user.organizationId, email: user.email, name: user.name, isAdmin: user.isAdmin }
  const [campaign] = await db.select({ id: schema.groups.id, name: schema.groups.name }).from(schema.groups).where(and(eq(schema.groups.organizationId, user.organizationId), isNull(schema.groups.deletedAt), ilike(schema.groups.name, `%${CAMPAIGN}%`))).limit(1)
  if (!campaign) throw new Error('campaign not found')
  const definition = {
    entity: 'suppliers' as const,
    clauses: [
      { any: [{ field: 'campaigns', op: 'one_of' as const, value: [campaign.id] }] },
      { any: [{ field: 'data_source', op: 'is' as const, value: 'xtra' }] },
      { any: [{ field: 'signature_status', op: 'is' as const, value: 'signed' }] },
      { any: [{ field: 'task_status', op: 'not_one_of' as const, value: ['done', 'not_needed'] }] },
    ],
    columns: TOURISM_EXAMPLE_COLUMNS,
    sort: { field: 'signed_at' as const, dir: 'desc' as const },
  }
  const result = await runReport(session, { ...definition, page: 1, pageSize: 10 })
  console.log(`campaign: ${campaign.name}`)
  console.log(`matching suppliers: ${result.total}`)
  for (const row of result.rows) {
    const c = row.cells
    const mask = (v: unknown) => (typeof v === 'string' && v.length > 4 ? `${v.slice(0, 2)}…${v.slice(-2)}` : '—')
    console.log(`  ${String(c.name ?? '—')} · ח.פ. ${mask(c.tax_id)} · ${mask(c.contact_phone)} · חתם ${String(c.signed_at ?? '').slice(0, 10)} · הקמה: ${String(c.task_status ?? '—')} · אחראי: ${String(c.assignee ?? '—') === '—' ? '—' : 'כן'}`)
  }
  const { buffer, rows } = await buildReportWorkbook(session, definition)
  writeFileSync(OUT, buffer)
  console.log(`xlsx rows: ${rows} → ${OUT}`)
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error)
  process.exit(1)
})
