import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

/**
 * The ways the public flow is expected NOT to work, against a dev server
 * with log-only notifications: hostile input, retries, duplicates, the
 * wrong order of things. Nothing here may create a duplicate supplier or a
 * second open agreement, and nothing may fail silently.
 *
 *   E2E_BASE=http://localhost:3057 npx tsx scripts/qa/tourism-failures.ts
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const DB = process.env.E2E_DB ?? 'postgres://xtra:xtra@localhost:5433/xtra_sign'
const sql = postgres(DB, { max: 1 })

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`${ok ? '✓' : '✗'} ${name}${extra ? ' — ' + extra : ''}`)
  ok ? pass++ : fail++
}

const ip = () => `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`

async function register(body: unknown, fromIp = ip(), raw?: string) {
  const res = await fetch(`${BASE}/api/self-service/${FORM_ID}/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-forwarded-for': fromIp },
    body: raw ?? JSON.stringify(body),
  })
  return { status: res.status, json: (await res.json().catch(() => null)) as Record<string, unknown> | null }
}

const values = (stamp: number, overrides: Record<string, string> = {}) => ({
  businessName: `FAIL-TEST עסק ${stamp}`,
  taxId: String(520000000 + (stamp % 9000000)),
  signatoryName: 'בודק בדיקות',
  signatoryRole: 'מנהל',
  phone: `053${String(1000000 + (stamp % 8999999))}`,
  email: `fail-${stamp}@example.com`,
  ...overrides,
})

async function registrations(taxId: string) {
  return sql`select id, status, agreement_id from project_leads where data->>'taxId' = ${taxId} order by created_at`
}

let FORM_ID = ''

/** The register API is keyed by the project's form id; the joining page carries it. */
async function discoverFormId(): Promise<string> {
  const html = await (await fetch(`${BASE}/tourism-2026/join`)).text()
  const match = html.match(/data-form-id="([^"]+)"/)
  if (!match) throw new Error('joining page has no form id — is self-service on?')
  return match[1]
}

async function main() {
  FORM_ID = await discoverFormId()
  const stamp = Date.now()
  const base = values(stamp)

  // 1. Honeypot: a convincing answer, nothing created.
  {
    const r = await register({ values: base, website: 'http://spam.example', idempotencyKey: randomUUID() })
    check('honeypot answers like a success', r.status === 200 && r.json?.kind === 'ready', String(r.status))
    check('honeypot creates nothing', (await registrations(base.taxId)).length === 0)
  }

  // 2. Field errors, one per field, nothing created.
  {
    const r = await register({ values: { ...base, taxId: '12', phone: '03-1234567', email: 'nope' }, idempotencyKey: randomUUID() })
    const fields = (r.json?.error as { fields?: Record<string, string> } | undefined)?.fields ?? {}
    check('invalid fields → 400 naming taxId, phone, email', r.status === 400 && Boolean(fields.taxId && fields.phone && fields.email), JSON.stringify(fields))
    check('invalid submission creates nothing', (await registrations('12')).length === 0)
  }

  // 3. Oversized body, bad key, non-JSON.
  {
    const huge = JSON.stringify({ values: { ...base, businessName: 'x'.repeat(60_000) }, idempotencyKey: randomUUID() })
    const r = await register(null, ip(), huge)
    check('oversized body → 413', r.status === 413, String(r.status))
    const badKey = await register({ values: base, idempotencyKey: 'short' })
    check('malformed idempotency key → 400', badKey.status === 400, String(badKey.status))
    const notJson = await register(null, ip(), '{not json')
    check('non-JSON body → 400', notJson.status === 400, String(notJson.status))
  }

  // 4. A real registration, then the same key again: one supplier, one
  //    agreement, two working links.
  const key = randomUUID()
  const first = await register({ values: base, idempotencyKey: key })
  check('registration → ready with a token', first.status === 200 && first.json?.kind === 'ready' && typeof first.json?.token === 'string', JSON.stringify(first.json))
  const token1 = String(first.json?.token)
  const replay = await register({ values: base, idempotencyKey: key })
  check('replay → ready with another token', replay.status === 200 && replay.json?.kind === 'ready' && replay.json?.token !== token1)
  const token2 = String(replay.json?.token)
  {
    const rows = await registrations(base.taxId)
    check('one registration row', rows.length === 1 && rows[0].status === 'converted', JSON.stringify(rows))
    const suppliers = await sql`select id from companies where regexp_replace(coalesce(tax_id,''), '\\D', '', 'g') = ${base.taxId} and deleted_at is null`
    check('one supplier', suppliers.length === 1)
    const agreements = await sql`select id, status from agreements where company_id = ${suppliers[0].id}`
    check('one agreement, sent', agreements.length === 1 && agreements[0].status === 'sent', JSON.stringify(agreements))
    for (const t of [token1, token2]) {
      const page = await fetch(`${BASE}/tourism-2026/sign/${t}`)
      const html = await page.text()
      check(`link ${t.slice(0, 6)}… opens the resume page`, page.status === 200 && html.includes('המשך חתימה') && !html.includes('תוקף הקישור הסתיים'))
    }
    const deliveries = await sql`select channel, status from deliveries where agreement_id = ${agreements[0].id}`
    check('deliveries recorded once (failed in log-only mode) without stopping the flow, and not repeated by the replay', deliveries.length === 2 && deliveries.every((d) => d.status === 'failed'), JSON.stringify(deliveries))
    const notes = await sql`select title from notifications where title like ${'%' + base.businessName + '%'} or body like ${'%' + base.businessName + '%'}`
    check('staff notified of the registration', notes.length >= 1)
  }

  // 5. Download before signing: refused.
  {
    const r = await fetch(`${BASE}/api/sign/${token1}/download`, { redirect: 'manual' })
    check('download before signing → 404', r.status === 404, String(r.status))
    const thanks = await fetch(`${BASE}/tourism-2026/thanks/${token1}`, { redirect: 'manual' })
    check('thank-you before signing sends back to signing', (thanks.status === 307 || thanks.status === 302) && (thanks.headers.get('location') ?? '').includes('/tourism-2026/sign/'), String(thanks.headers.get('location')))
  }

  // 6. Same business, spelled differently: same supplier, same agreement.
  {
    const r = await register({
      values: { ...base, taxId: `${base.taxId.slice(0, 3)}-${base.taxId.slice(3)}`, phone: `+972 ${base.phone.slice(1, 3)}-${base.phone.slice(3)}`, email: base.email.toUpperCase() },
      idempotencyKey: randomUUID(),
    })
    check('formatting variants → ready', r.status === 200 && r.json?.kind === 'ready')
    const suppliers = await sql`select id from companies where regexp_replace(coalesce(tax_id,''), '\\D', '', 'g') = ${base.taxId} and deleted_at is null`
    check('still one supplier', suppliers.length === 1)
    const agreements = await sql`select status from agreements where company_id = ${suppliers[0].id}`
    check('still one agreement', agreements.length === 1, JSON.stringify(agreements))
  }

  // 7. Changed details: the open agreement is superseded, never duplicated.
  {
    const r = await register({ values: { ...base, signatoryName: 'מישהי אחרת', signatoryRole: 'סמנכ"לית' }, idempotencyKey: randomUUID() })
    check('changed details → ready', r.status === 200 && r.json?.kind === 'ready')
    const suppliers = await sql`select id from companies where regexp_replace(coalesce(tax_id,''), '\\D', '', 'g') = ${base.taxId} and deleted_at is null`
    const agreements = await sql`select status from agreements where company_id = ${suppliers[0].id} order by created_at`
    check('old agreement cancelled, one new open', agreements.length === 2 && agreements[0].status === 'canceled' && agreements[1].status === 'sent', JSON.stringify(agreements))
    const dead = await fetch(`${BASE}/tourism-2026/sign/${token1}`)
    check('the old link no longer opens', (await dead.text()).includes('תוקף הקישור הסתיים'))
  }

  // 8. A business that already signed (from a previous run) cannot sign twice.
  {
    const [signed] = await sql`
      select pl.data->>'taxId' as tax_id from project_leads pl join agreements a on a.id = pl.agreement_id
      where pl.source = 'self_service' and a.status = 'signed' order by pl.created_at desc limit 1`
    if (signed) {
      const before = await sql`select count(*)::int as n from agreements a join companies c on c.id = a.company_id where regexp_replace(coalesce(c.tax_id,''), '\\D', '', 'g') = ${signed.tax_id}`
      const r = await register({ values: { ...base, taxId: signed.tax_id }, idempotencyKey: randomUUID() })
      check('already signed → already_signed, no new agreement', r.status === 200 && r.json?.kind === 'already_signed', JSON.stringify(r.json))
      const after = await sql`select count(*)::int as n from agreements a join companies c on c.id = a.company_id where regexp_replace(coalesce(c.tax_id,''), '\\D', '', 'g') = ${signed.tax_id}`
      check('agreement count unchanged after a second attempt', before[0].n === after[0].n)
    } else {
      console.log('· (no signed registration yet — run tourism-e2e.ts first for the already-signed case)')
    }
  }

  // 9. Unknown and garbage tokens.
  {
    for (const path of ['/tourism-2026/sign/not-a-real-token-at-all-0000', '/tourism-2026/thanks/not-a-real-token-at-all-0000']) {
      const r = await fetch(`${BASE}${path}`)
      check(`${path.split('/')[2]} with an unknown token shows the expired message`, r.status === 200 && (await r.text()).includes('תוקף הקישור הסתיים'))
    }
    const api = await fetch(`${BASE}/api/sign/not-a-real-token-at-all-0000/otp`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: BASE }, body: JSON.stringify({ action: 'send' }) })
    check('OTP on an unknown token → 404', api.status === 404, String(api.status))
  }

  // 10. Rate limit per IP: the 11th submission in a window is refused.
  {
    const one = ip()
    let refused = 0
    for (let i = 0; i < 12; i++) {
      const r = await register({ values: values(stamp + 1000 + i), idempotencyKey: randomUUID() }, one)
      if (r.status === 429) refused++
    }
    check('per-IP rate limit kicks in (10 per 15 min)', refused >= 2, `${refused} refused`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await sql.end()
  process.exit(fail === 0 ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await sql.end()
  process.exit(1)
})
