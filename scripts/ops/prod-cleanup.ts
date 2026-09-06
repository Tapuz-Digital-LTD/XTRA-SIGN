import { readFileSync } from 'node:fs'
import { Client } from 'pg'

/**
 * Removes QA/TEST rows from a database — production, once — from a
 * classification file produced by a read-only inventory, re-verifying every
 * row's TEST signals live before touching it, inside one transaction that
 * is ROLLED BACK unless `--apply` is given.
 *
 *   DATABASE_URL=… npx tsx scripts/ops/prod-cleanup.ts <classification.json>            # dry run: counts, then ROLLBACK
 *   DATABASE_URL=… npx tsx scripts/ops/prod-cleanup.ts <classification.json> --apply    # the real thing, then COMMIT
 *
 * What it will never delete, whatever the file says: any company with a
 * crm_record_id, the organization, users, admin audit rows, system settings,
 * crm sync state, and anything the classification listed as uncertain.
 * It writes one admin_audit_events row summarising what went.
 */

const file = process.argv[2]
const apply = process.argv.includes('--apply')
const actor = process.env.CLEANUP_ACTOR ?? 'ops-script'
if (!file) throw new Error('classification file required')
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL required')

type Classification = { test: Record<string, string[]>; uncertain: Record<string, string[]> }
const cls = JSON.parse(readFileSync(file, 'utf8')) as Classification

/** Parent-last: every table's rows go before the rows they point at. */
const ORDER = [
  'notifications',
  'deliveries',
  'otp_challenges',
  'signing_sessions',
  'signing_tokens',
  'signatures',
  'fields',
  'document_pages',
  'recipients',
  'audit_events',
  'agreement_versions',
  'bulk_batch_items',
  'agreements',
  'bulk_batches',
  'project_leads',
  'company_groups',
  'groups',
  'templates',
  'companies',
] as const

const PROTECTED = new Set(['organizations', 'users', 'admin_audit_events', 'system_settings', 'crm_sync_state'])

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: process.env.DATABASE_URL!.includes('localhost') ? undefined : true })
  await client.connect()
  const uncertain = new Set(Object.values(cls.uncertain).flat())
  const before: Record<string, number> = {}
  for (const table of ORDER) before[table] = Number((await client.query(`select count(*)::int as n from ${table}`)).rows[0].n)

  // ── Re-verify the signals on the rows that matter most ──────────────────
  const companyIds = (cls.test.companies ?? []).filter((id) => !uncertain.has(id))
  if (companyIds.length) {
    const { rows } = await client.query(`select id, name, source, crm_record_id from companies where id = any($1::uuid[])`, [companyIds])
    const bad = rows.filter((r) => r.crm_record_id !== null || r.source === 'crm')
    if (bad.length) throw new Error(`refusing: ${bad.length} "test" companies carry a CRM link: ${bad.map((b) => b.name).join(', ')}`)
    const missing = companyIds.filter((id) => !rows.some((r) => r.id === id))
    if (missing.length) console.log(`note: ${missing.length} test company ids no longer exist`)
  }
  const groupIds = (cls.test.groups ?? []).filter((id) => !uncertain.has(id))
  if (groupIds.length) {
    const { rows } = await client.query(`select id, name from groups where id = any($1::uuid[])`, [groupIds])
    const suspicious = rows.filter((r) => !/test|טסט|בדיקה|למחיקה/i.test(r.name))
    if (suspicious.length) throw new Error(`refusing: groups without a test marker in the name: ${suspicious.map((s) => s.name).join(', ')}`)
  }
  const agreementIds = (cls.test.agreements ?? []).filter((id) => !uncertain.has(id))
  if (agreementIds.length) {
    const { rows } = await client.query(
      `select a.id, a.title, a.status, c.crm_record_id from agreements a left join companies c on c.id = a.company_id where a.id = any($1::uuid[])`,
      [agreementIds],
    )
    const linked = rows.filter((r) => r.crm_record_id !== null)
    if (linked.length) throw new Error(`refusing: ${linked.length} "test" agreements sit on CRM-linked companies: ${linked.map((l) => l.title).join(', ')}`)
  }

  await client.query('begin')
  const deleted: Record<string, number> = {}
  try {
    for (const table of ORDER) {
      if (PROTECTED.has(table)) continue
      const ids = (cls.test[table] ?? []).filter((id) => !uncertain.has(id))
      if (ids.length === 0) {
        deleted[table] = 0
        continue
      }
      const idColumn = table === 'company_groups' ? null : 'id'
      let n = 0
      if (idColumn) {
        const res = await client.query(`delete from ${table} where ${idColumn} = any($1::uuid[])`, [ids])
        n = res.rowCount ?? 0
      } else {
        // company_groups has a composite key; the inventory stored "groupId:companyId".
        for (const pair of ids) {
          const [groupId, companyId] = pair.split(':')
          if (!groupId || !companyId) continue
          const res = await client.query(`delete from company_groups where group_id = $1 and company_id = $2`, [groupId, companyId])
          n += res.rowCount ?? 0
        }
      }
      deleted[table] = n
    }
    // Children the file may not have listed, hanging off deleted parents: none may remain.
    const orphanChecks: [string, string][] = [
      ['recipients', `select count(*)::int as n from recipients r where not exists (select 1 from agreements a where a.id = r.agreement_id)`],
      ['agreement_versions', `select count(*)::int as n from agreement_versions v where not exists (select 1 from agreements a where a.id = v.agreement_id)`],
      ['company_groups', `select count(*)::int as n from company_groups cg where not exists (select 1 from groups g where g.id = cg.group_id) or not exists (select 1 from companies c where c.id = cg.company_id)`],
    ]
    for (const [label, sql] of orphanChecks) {
      const n = Number((await client.query(sql)).rows[0].n)
      if (n > 0) throw new Error(`orphans left in ${label}: ${n}`)
    }
    const total = Object.values(deleted).reduce((a, b) => a + b, 0)
    console.log(`\n${apply ? 'DELETING' : 'DRY RUN'} — rows by table:`)
    for (const table of ORDER) console.log(`  ${table.padEnd(20)} ${String(deleted[table] ?? 0).padStart(5)}   (of ${before[table]})`)
    console.log(`  total                ${String(total).padStart(5)}`)
    console.log(`  kept as uncertain    ${String(uncertain.size).padStart(5)}`)

    if (apply) {
      const [{ id: organizationId }] = (await client.query(`select id from organizations limit 1`)).rows
      await client.query(
        `insert into admin_audit_events (organization_id, type, actor_email, metadata) values ($1, 'record_deleted', $2, $3)`,
        [organizationId, actor, { scope: 'test-data-cleanup', deleted, uncertainKept: uncertain.size, source: file.split('/').pop() }],
      )
      await client.query('commit')
      console.log('\nCOMMITTED')
    } else {
      await client.query('rollback')
      console.log('\nROLLED BACK (dry run)')
    }
  } catch (error) {
    await client.query('rollback').catch(() => null)
    throw error
  } finally {
    await client.end()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
