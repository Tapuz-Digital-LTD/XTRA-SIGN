import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { saveListColumns } from '@/server/projects/list-columns'

/** Which of the form's answers this campaign's tables and files show as columns. */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { columns?: unknown } | null
    if (!body || !Array.isArray(body.columns)) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    return NextResponse.json({ columns: await saveListColumns(session, id, body.columns) })
  } catch (error) {
    return templateFailure(error)
  }
}
