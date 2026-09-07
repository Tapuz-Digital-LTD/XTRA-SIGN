import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { confirmWhatsapp } from '@/server/invitations/invitations'

/** The rep's word on a WhatsApp share: "כן, ההודעה נשלחה" or "לא נשלחה". Correctable. */
export async function POST(request: Request, context: { params: Promise<{ sendId: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { sendId } = await context.params
    const body = (await request.json().catch(() => null)) as { sent?: unknown } | null
    if (typeof body?.sent !== 'boolean') return NextResponse.json({ error: { message: 'חסר אישור.' } }, { status: 400 })
    const result = await confirmWhatsapp(session, sendId, body.sent)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
