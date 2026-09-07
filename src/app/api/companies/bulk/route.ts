import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { bulkEditCompanies, type BulkAction } from '@/server/tags/tags'

const ACTIONS: BulkAction[] = ['add_tags', 'remove_tags', 'notes']
const MAX_ROWS = 500

const strings = (v: unknown, max: number) => (Array.isArray(v) ? (v.filter((x) => typeof x === 'string') as string[]).slice(0, max) : [])

/**
 * One edit over a selection of companies: add tags, remove tags, or append a
 * note. `preview: true` only counts. Answers `{ eligible, updated, skipped }`.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })

    const action = ACTIONS.find((a) => a === body.action)
    if (!action) return NextResponse.json({ error: { message: 'פעולה לא מוכרת.' } }, { status: 400 })

    const companyIds = strings(body.companyIds, MAX_ROWS)
    if (companyIds.length === 0) return NextResponse.json({ error: { message: 'לא נבחרו רשומות.' } }, { status: 400 })

    const result = await bulkEditCompanies(session, {
      companyIds,
      action,
      tagIds: strings(body.tagIds, 50),
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      preview: body.preview === true,
    })
    return result.ok ? NextResponse.json(result) : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
