import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { sendMessageTest } from '@/server/projects/messages'
import { DEFAULT_MESSAGES, type MessageEvent } from '@/lib/message-template'

/** A test copy to the staff member's own phone/address; never to a registrant. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { event?: unknown; override?: unknown; phone?: unknown; email?: unknown } | null
    const event = typeof body?.event === 'string' && body.event in DEFAULT_MESSAGES ? (body.event as MessageEvent) : null
    if (!event) return NextResponse.json({ error: { message: 'אירוע לא מוכר.' } }, { status: 400 })
    const phone = typeof body?.phone === 'string' && body.phone.trim() ? body.phone.trim() : undefined
    const email = typeof body?.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ? body.email.trim() : undefined
    const result = await sendMessageTest(session, id, { event, override: body?.override, phone, email })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
