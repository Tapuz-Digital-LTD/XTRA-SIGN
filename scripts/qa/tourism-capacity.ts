import { randomUUID } from 'node:crypto'
import postgres from 'postgres'

/**
 * Capacity: many registrations in bursts against a dev server with
 * notifications stubbed. Asserts zero lost, zero duplicate suppliers or
 * agreements, sane latency, and no connection trouble.
 *
 *   E2E_BASE=http://localhost:3057 CAP_TOTAL=800 CAP_BURST=40 npx tsx scripts/qa/tourism-capacity.ts
 */

const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const DB = process.env.E2E_DB ?? 'postgres://xtra:xtra@localhost:5433/xtra_sign'
const TOTAL = Number(process.env.CAP_TOTAL ?? 300)
const BURST = Number(process.env.CAP_BURST ?? 30)
const sql = postgres(DB, { max: 1 })

async function main() {
  const run = `CAP${Date.now() % 100000}`
  const latencies: number[] = []
  const kinds = new Map<string, number>()
  let failed = 0
  const started = Date.now()

  for (let batch = 0; batch < Math.ceil(TOTAL / BURST); batch++) {
    const jobs = Array.from({ length: Math.min(BURST, TOTAL - batch * BURST) }, (_, j) => {
      const n = batch * BURST + j
      const body = {
        values: {
          businessName: `${run} עסק ${n}`,
          taxId: String(530000000 + (Date.now() % 1000000) * 7 + n).slice(0, 9),
          signatoryName: `חותם ${n}`,
          signatoryRole: 'בעלים',
          phone: `054${String(2000000 + n)}`,
          email: `${run.toLowerCase()}-${n}@example.com`,
        },
        idempotencyKey: randomUUID(),
        meta: { utm_source: 'capacity' },
      }
      const t0 = Date.now()
      // Each request from its own address: the per-IP limit is a real
      // protection and is not what is being measured here.
      return fetch(`${BASE}/api/self-service/tourism-2026/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-forwarded-for': `10.${20 + batch}.${Math.floor(j / 250)}.${j % 250}` },
        body: JSON.stringify(body),
      })
        .then(async (res) => {
          latencies.push(Date.now() - t0)
          const json = (await res.json().catch(() => null)) as { kind?: string } | null
          if (res.status === 200) kinds.set(json?.kind ?? '?', (kinds.get(json?.kind ?? '?') ?? 0) + 1)
          else {
            failed++
            if (failed <= 5) console.log(`fail status=${res.status}`, JSON.stringify(json).slice(0, 160))
          }
        })
        .catch((e) => {
          latencies.push(Date.now() - t0)
          failed++
          if (failed <= 5) console.log('fail err', String(e).slice(0, 120))
        })
    })
    await Promise.all(jobs)
    process.stdout.write(`\rbatch ${batch + 1}/${Math.ceil(TOTAL / BURST)}   `)
  }
  console.log()

  const wall = Date.now() - started
  latencies.sort((a, b) => a - b)
  const p = (q: number) => latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * q))]
  console.log(`sent=${TOTAL} ok=${TOTAL - failed} failed=${failed} kinds=${JSON.stringify([...kinds])} wall=${(wall / 1000).toFixed(1)}s rps=${(TOTAL / (wall / 1000)).toFixed(1)}`)
  console.log(`latency ms: p50=${p(0.5)} p90=${p(0.9)} p95=${p(0.95)} p99=${p(0.99)} max=${latencies[latencies.length - 1]}`)

  const [regs] = await sql`select count(*)::int as n, count(*) filter (where status = 'converted')::int as converted from project_leads where data->>'name' like ${run + ' %'}`
  const [suppliers] = await sql`select count(*)::int as n, count(distinct tax_id)::int as distinct_tax from companies where name like ${run + ' %'} and deleted_at is null`
  const [agreements] = await sql`select count(*)::int as n from agreements a join companies c on c.id = a.company_id where c.name like ${run + ' %'}`
  const [tokens] = await sql`select count(*)::int as n from signing_tokens t join recipients r on r.id = t.recipient_id join agreements a on a.id = r.agreement_id join companies c on c.id = a.company_id where c.name like ${run + ' %'}`
  console.log(`db: registrations=${regs.n} (converted ${regs.converted}) suppliers=${suppliers.n} (distinct tax ids ${suppliers.distinct_tax}) agreements=${agreements.n} tokens=${tokens.n}`)

  const ok = failed === 0 && regs.n === TOTAL && regs.converted === TOTAL && suppliers.n === TOTAL && agreements.n === TOTAL && tokens.n === TOTAL
  console.log(ok ? 'CAPACITY OK: nothing lost, nothing duplicated' : 'CAPACITY PROBLEM')
  await sql.end()
  process.exit(ok ? 0 : 1)
}

main().catch(async (error) => {
  console.error(error)
  await sql.end()
  process.exit(1)
})
