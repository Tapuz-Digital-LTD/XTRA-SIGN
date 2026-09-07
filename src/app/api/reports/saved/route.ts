import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { createSavedReport, listSavedReports } from '@/server/reports/engine/saved'

/** The reports saved by me and shared with the team. */
export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({ reports: await listSavedReports(session) })
  } catch (error) {
    return templateFailure(error)
  }
}

/** "שמור דוח": a name over the definition, personal or shared. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as { name?: unknown; definition?: unknown; shared?: unknown } | null
    const result = await createSavedReport(session, { name: body?.name, definition: body?.definition, shared: body?.shared })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ report: result.report })
  } catch (error) {
    return templateFailure(error)
  }
}
