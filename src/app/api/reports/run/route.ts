import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { ReportError, runReport } from '@/server/reports/engine/query'
import { cleanDefinition } from '@/server/reports/engine/saved'

/** One page of a report: the definition from the builder, validated against the registry, paged on the server. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    const definition = cleanDefinition(body)
    if (!definition) return NextResponse.json({ error: { message: 'בחרו מה להציג.' } }, { status: 400 })
    const page = typeof body?.page === 'number' ? body.page : Number(body?.page ?? 1)
    const pageSize = typeof body?.pageSize === 'number' ? body.pageSize : Number(body?.pageSize ?? 25)
    const result = await runReport(session, { ...definition, page: Number.isFinite(page) ? page : 1, pageSize: Number.isFinite(pageSize) ? pageSize : 25 })
    return NextResponse.json(result)
  } catch (error) {
    if (error instanceof ReportError) return NextResponse.json({ error: { message: error.message } }, { status: 400 })
    return templateFailure(error)
  }
}
