import { NextResponse } from 'next/server'
import { resendFailedMessage } from '@/server/attention/resend'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'

/** "שלח את המייל שוב": one failed message, sent again — optionally to a corrected address. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const gate = await consume('signingLink', `${session.userId}:${id}`)
    if (!gate.allowed) return NextResponse.json({ error: { message: 'נשלחו יותר מדי הודעות. נסו שוב מאוחר יותר.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    const body = (await request.json().catch(() => null)) as { sendId?: unknown; to?: unknown } | null
    if (typeof body?.sendId !== 'string') return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    const to = typeof body.to === 'string' ? body.to : undefined
    const result = await resendFailedMessage(session, { agreementId: id, sendId: body.sendId, to })
    if (result.ok) return NextResponse.json({ ok: true, state: result.state, sendId: result.sendId })
    return NextResponse.json({ error: { message: result.message, state: result.state } }, { status: result.state === 'already_sent' ? 409 : 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
