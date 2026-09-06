import { getDb, schema } from '../../src/server/db'
import { eq } from 'drizzle-orm'
import { getPublicSlugSettings, setPublicSlug } from '../../src/server/projects/public-slug'
import { findSelfServiceProjectBySkin } from '../../src/server/projects/self-service'
import type { StaffSession } from '../../src/server/auth/session'

/**
 * Acceptance: the public address changes campaign-a → campaign-b →
 * campaign-c and nothing breaks. Every old address answers with one
 * permanent redirect straight to the newest, the query string intact; the
 * register API, keyed by the form id, is untouched; the project id and the
 * form id never move. Puts the original address back at the end.
 *
 *   E2E_BASE=http://localhost:3057 npx dotenv-cli -e .env.local -- npx tsx scripts/qa/slug-check.ts
 */
const BASE = process.env.E2E_BASE ?? 'http://localhost:3057'
const tag = Math.random().toString(36).slice(2, 7)
const A = `campaign-a-${tag}`
const B = `campaign-b-${tag}`
const C = `campaign-c-${tag}`

let failures = 0
const check = (label: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${detail ? `  (${detail})` : ''}`)
  if (!ok) failures++
}

/** Same parameters, whatever the encoding: a space may come back as "+". */
const sameQuery = (a: string | null, b: string) => {
  if (!a) return false
  const [pa, qa = ''] = a.split('?')
  const [pb, qb = ''] = b.split('?')
  return pa === pb && new URLSearchParams(qa).toString() === new URLSearchParams(qb).toString()
}

async function hop(path: string) {
  const res = await fetch(`${BASE}${path}`, { redirect: 'manual' })
  return { status: res.status, location: res.headers.get('location'), body: res.status === 200 ? await res.text() : '' }
}

async function main() {
  const project = await findSelfServiceProjectBySkin('tourism-2026')
  if (!project) throw new Error('tourism project is not live locally')
  const db = getDb()
  const [owner] = await db.select().from(schema.users).where(eq(schema.users.id, project.owner.id))
  const session: StaffSession = { userId: owner.id, organizationId: owner.organizationId, email: owner.email, name: owner.name, isAdmin: true }
  const original = project.publicSlug
  const { groupId, formId } = project
  console.log(`project ${groupId}  form ${formId}  address ${original}`)

  try {
    for (const slug of [A, B, C]) {
      const r = await setPublicSlug(session, groupId, slug)
      check(`set ${slug}`, r.ok, r.ok ? '' : r.message)
    }

    // Every old address → the newest, directly, with the query preserved.
    for (const old of [original, A, B]) {
      const q = '?utm_source=facebook&utm_campaign=nov&x=1%202'
      const root = await hop(`/${old}${q}`)
      check(`/${old} → 308 to /${C}`, root.status === 308 && sameQuery(root.location, `/${C}${q}`), `${root.status} ${root.location}`)
      const join = await hop(`/${old}/join${q}`)
      check(`/${old}/join → /${C}/join`, join.status === 308 && sameQuery(join.location, `/${C}/join${q}`), `${join.status} ${join.location}`)
      const sign = await hop(`/${old}/sign/sometoken`)
      check(`/${old}/sign/t → /${C}/sign/t`, sign.status === 308 && sign.location === `/${C}/sign/sometoken`, `${sign.status} ${sign.location}`)
    }

    // The current address answers; the form id on it is the project's.
    const live = await hop(`/${C}/join`)
    const formOnPage = live.body.match(/data-form-id="([^"]+)"/)?.[1]
    check(`/${C}/join is 200`, live.status === 200, String(live.status))
    check('form id on the page is the project form id', formOnPage === formId, `${formOnPage}`)
    check('/campaign-nobody is 404', (await hop(`/campaign-nobody-${tag}`)).status === 404)

    // Reserved paths and loops.
    check('reserved: api', !(await setPublicSlug(session, groupId, 'api')).ok)
    check('self-redirect is a no-op', (await setPublicSlug(session, groupId, C)).ok)
    const after = await getPublicSlugSettings(session, groupId)
    check('one current, three aliases', after.current === C && after.history.length >= 3, `${after.current} / ${after.history.length}`)

    // The project and the form id did not move.
    const again = await findSelfServiceProjectBySkin('tourism-2026')
    check('project id unchanged', again?.groupId === groupId)
    check('form id unchanged', again?.formId === formId)

    // A submission through the form id lands on the same project (log-only).
    const res = await fetch(`${BASE}/api/self-service/${formId}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: BASE },
      body: JSON.stringify({
        idempotencyKey: `slugcheck-${tag}-${Date.now()}`,
        values: {
          businessName: `TEST slug ${tag}`,
          taxId: `51${String(Date.now()).slice(-7)}`,
          signatoryName: 'TEST בודק',
          signatoryRole: 'QA',
          phone: '052-0000000',
          email: `slug-${tag}@example.test`,
        },
        meta: { landing_url: `${BASE}/${A}/join` },
      }),
    })
    const data = (await res.json().catch(() => null)) as { ok?: boolean; kind?: string } | null
    check('register through the form id', res.ok && data?.ok === true, `${res.status} ${data?.kind}`)
  } finally {
    const back = await setPublicSlug(session, groupId, original)
    check(`address restored to ${original}`, back.ok)
  }

  console.log(failures === 0 ? '\nSLUG CHECK ALL GREEN' : `\n${failures} FAILURES`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
