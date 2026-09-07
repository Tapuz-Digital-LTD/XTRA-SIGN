import { NextResponse } from 'next/server'
import { resolveFailure } from '@/server/attention/resend'
import { requireSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** "סמן כטופל": a failure handled by hand leaves the tab, with a note saying how. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    await authorizeAgreementAccess(session, id)
    const body = (await request.json().catch(() => null)) as { sendId?: unknown; note?: unknown } | null
    if (typeof body?.sendId !== 'string') return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const result = await resolveFailure(session, { sendId: body.sendId, note: typeof body.note === 'string' ? body.note : '' })
    return result.ok ? NextResponse.json({ ok: true }) : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
