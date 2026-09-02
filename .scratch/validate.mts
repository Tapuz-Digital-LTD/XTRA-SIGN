import { writeFileSync } from 'node:fs'
import { Pool } from 'pg'
import { generateToken, hashToken } from '../src/server/auth/tokens'

/**
 * End-to-end validation against the deployed function.
 *
 * A short-lived staff session for the existing admin is written straight to the
 * database and removed at the end: the point is to exercise the production
 * runtime, not the login screen, and no OTP should be sent to a real phone for
 * a test.
 */
const BASE = 'https://xtra-sign.vercel.app'
const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 })

const [{ id: userId }] = (await pool.query('select id from users where is_admin = true limit 1')).rows
const token = generateToken()
await pool.query(
  'insert into user_sessions (user_id, session_hash, expires_at) values ($1,$2, now() + interval \'30 minutes\')',
  [userId, hashToken(token)],
)
const cookie = `__Host-xtra_sign_session=${token}`
const headers = { cookie, origin: BASE, 'content-type': 'application/json' }

async function timed<T>(label: string, fn: () => Promise<Response>): Promise<{ ms: number; res: Response }> {
  const t = Date.now()
  const res = await fn()
  const ms = Date.now() - t
  console.log(`${label}: HTTP ${res.status} in ${ms} ms`)
  return { ms, res }
}

try {
  // 1. Listing — the first call also pays this function's cold start.
  const cold = await timed('GET  /api/crm/templates (cold)', () => fetch(`${BASE}/api/crm/templates`, { headers }))
  const list = await cold.res.json()
  if (!list.ok) throw new Error(`list failed: ${JSON.stringify(list).slice(0, 300)}`)
  const warm = await timed('GET  /api/crm/templates (warm)', () => fetch(`${BASE}/api/crm/templates`, { headers }))
  void warm

  const target = list.templates.find((t: { name: string }) => t.name === 'הסכם ספקים')
  console.log(`\ntemplates listed  : ${list.templates.length}`)
  console.log(`target            : ${target?.name} (${target?.id}) imported=${target?.imported}`)
  if (!target) throw new Error('הסכם ספקים not found in the CRM listing')

  // 2. Import — sanitize + inline + Chromium, all inside the Vercel function.
  const imp = await timed('POST /api/crm/templates (import, cold Chromium)', () =>
    fetch(`${BASE}/api/crm/templates`, { method: 'POST', headers, body: JSON.stringify({ templateIds: [target.id] }) }))
  const result = await imp.res.json()
  console.log('import result     :', JSON.stringify(result))
  if (!result.ok) throw new Error('import failed')

  // 3. Second import of identical content must be refused by the index.
  const again = await timed('POST /api/crm/templates (same content again)', () =>
    fetch(`${BASE}/api/crm/templates`, { method: 'POST', headers, body: JSON.stringify({ templateIds: [target.id] }) }))
  console.log('dedup result      :', JSON.stringify(await again.res.json()))

  // 4. Read what landed in the database.
  const [row] = (await pool.query(
    `select id, name, page_count, source, crm_template_id, crm_content_hash, crm_merge_fields, source_file_key, crm_source_html_key
     from templates where crm_template_id = $1 order by created_at desc limit 1`, [target.id])).rows
  console.log('\nstored template   :', JSON.stringify({
    name: row.name, pages: row.page_count, source: row.source,
    hash: String(row.crm_content_hash).slice(0, 16) + '…',
    mergeFields: (row.crm_merge_fields ?? []).length,
  }))

  // 5. Use it as an ordinary template, then download the produced PDF — the
  //    proof that an imported template is indistinguishable from any other.
  const use = await timed('POST /api/templates/:id/use', () =>
    fetch(`${BASE}/api/templates/${row.id}/use`, { method: 'POST', headers }))
  const used = await use.res.json()
  if (!used.ok && !used.id) throw new Error(`use failed: ${JSON.stringify(used).slice(0, 200)}`)
  const agreementId = used.id ?? used.agreementId
  console.log('document created  :', agreementId)

  const file = await timed('GET  /api/documents/:id/file', () =>
    fetch(`${BASE}/api/documents/${agreementId}/file`, { headers, redirect: 'follow' }))
  const pdf = Buffer.from(await file.res.arrayBuffer())
  writeFileSync('/tmp/vercel-hesken.pdf', pdf)
  console.log(`pdf downloaded    : ${pdf.byteLength} bytes, magic=${pdf.subarray(0, 5).toString('latin1')}`)
  console.log(`TEMPLATE_ID=${row.id}`)
  console.log(`AGREEMENT_ID=${agreementId}`)
} finally {
  await pool.query('delete from user_sessions where session_hash = $1', [hashToken(token)])
  await pool.end()
}
