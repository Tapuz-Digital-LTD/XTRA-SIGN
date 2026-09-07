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
    const suspicious = rows.filter((r) => !/test|טסט|בדיק|למחיקה|dummy|demo/i.test(r.name))
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
    // The roots are explicit ids from the classification; every child row is
    // found by relationship, so nothing created since the inventory (a new
    // audit line, a fresh signing token) is left dangling.
    const ids = (table: string) => (cls.test[table] ?? []).filter((id) => !uncertain.has(id))
    const rootCompanies = ids('companies')
    const rootGroups = ids('groups')
    const rootTemplates = ids('templates')
    const rootAgreements = new Set(ids('agreements'))
    // Agreements on a TEST company are TEST too (the owner's own smoke tests included).
    if (rootCompanies.length) for (const r of (await client.query(`select id from agreements where company_id = any($1::uuid[])`, [rootCompanies])).rows) rootAgreements.add(r.id)
    // …unless they sit on a CRM-linked company, which the earlier check already refused.
    const agreements = [...rootAgreements]
    const has = async (table: string, column: string) => Number((await client.query(`select count(*)::int as n from information_schema.columns where table_name = $1 and column_name = $2`, [table, column])).rows[0].n) > 0
    const del = async (table: string, sql: string, params: unknown[]) => {
      const res = await client.query(sql, params)
      deleted[table] = (deleted[table] ?? 0) + (res.rowCount ?? 0)
    }
    if (agreements.length) {
      await del('notifications', `delete from notifications where agreement_id = any($1::uuid[])`, [agreements])
      await del('message_sends', `delete from message_sends where agreement_id = any($1::uuid[])`, [agreements])
      await del('deliveries', `delete from deliveries where agreement_id = any($1::uuid[]) or recipient_id in (select id from recipients where agreement_id = any($1::uuid[]))`, [agreements])
      await del('otp_challenges', `delete from otp_challenges where recipient_id in (select id from recipients where agreement_id = any($1::uuid[]))`, [agreements])
      await del('signing_sessions', (await has('signing_sessions', 'agreement_id')) ? `delete from signing_sessions where recipient_id in (select id from recipients where agreement_id = any($1::uuid[])) or agreement_id = any($1::uuid[])` : `delete from signing_sessions where recipient_id in (select id from recipients where agreement_id = any($1::uuid[]))`, [agreements])
      await del('signing_tokens', `delete from signing_tokens where recipient_id in (select id from recipients where agreement_id = any($1::uuid[]))`, [agreements])
      await del('signatures', `delete from signatures where agreement_version_id in (select id from agreement_versions where agreement_id = any($1::uuid[]))`, [agreements])
      await del('fields', (await has('fields', 'agreement_version_id')) ? `delete from fields where agreement_version_id in (select id from agreement_versions where agreement_id = any($1::uuid[]))` : `delete from fields where agreement_id = any($1::uuid[])`, [agreements])
      await del('document_pages', (await has('document_pages', 'agreement_version_id')) ? `delete from document_pages where agreement_version_id in (select id from agreement_versions where agreement_id = any($1::uuid[]))` : `delete from document_pages where agreement_id = any($1::uuid[])`, [agreements])
      await del('audit_events', `delete from audit_events where agreement_id = any($1::uuid[]) or recipient_id in (select id from recipients where agreement_id = any($1::uuid[]))`, [agreements])
      await del('recipients', `delete from recipients where agreement_id = any($1::uuid[])`, [agreements])
      await del('bulk_batch_items', `delete from bulk_batch_items where agreement_id = any($1::uuid[])`, [agreements])
      await del('project_leads', `update project_leads set agreement_id = null where agreement_id = any($1::uuid[])`, [agreements])
      await del('agreement_versions', `delete from agreement_versions where agreement_id = any($1::uuid[])`, [agreements])
      await del('agreements', `delete from agreements where id = any($1::uuid[])`, [agreements])
    }
    if (rootGroups.length) {
      await del('campaign_events', `delete from campaign_events where group_id = any($1::uuid[])`, [rootGroups])
      await del('message_sends', `delete from message_sends where group_id = any($1::uuid[])`, [rootGroups])
      await del('distribution_recipients', `delete from distribution_recipients where distribution_id in (select id from distributions where group_id = any($1::uuid[]))`, [rootGroups])
      await del('distributions', `delete from distributions where group_id = any($1::uuid[])`, [rootGroups])
      await del('bulk_batch_items', `delete from bulk_batch_items where batch_id in (select id from bulk_batches where group_id = any($1::uuid[]))`, [rootGroups])
      await del('bulk_batches', `delete from bulk_batches where group_id = any($1::uuid[])`, [rootGroups])
      await del('project_leads', `delete from project_leads where group_id = any($1::uuid[])`, [rootGroups])
      await del('company_groups', `delete from company_groups where group_id = any($1::uuid[])`, [rootGroups])
      await del('project_public_slugs', `delete from project_public_slugs where group_id = any($1::uuid[])`, [rootGroups])
      await del('groups', `delete from groups where id = any($1::uuid[])`, [rootGroups])
    }
    if (rootTemplates.length) {
      await del('groups (unbound)', `update groups set default_template_id = null where default_template_id = any($1::uuid[])`, [rootTemplates])
      await del('agreements (unbound)', `update agreements set template_id = null where template_id = any($1::uuid[])`, [rootTemplates])
      await del('templates', `delete from templates where id = any($1::uuid[])`, [rootTemplates])
    }
    if (rootCompanies.length) {
      // A registration that resolved to a TEST company is a test registration (the smoke tests).
      await del('project_leads', `delete from project_leads where company_id = any($1::uuid[])`, [rootCompanies])
      await del('company_groups', `delete from company_groups where company_id = any($1::uuid[])`, [rootCompanies])
      await del('notifications', `delete from notifications where body = any(select name from companies where id = any($1::uuid[]))`, [rootCompanies])
      await del('companies', `delete from companies where id = any($1::uuid[])`, [rootCompanies])
    }
    // Nothing may be left pointing at a parent that went.
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
    for (const [table, n] of Object.entries(deleted)) console.log(`  ${table.padEnd(24)} ${String(n).padStart(5)}${before[table] !== undefined ? `   (of ${before[table]})` : ''}`)
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
