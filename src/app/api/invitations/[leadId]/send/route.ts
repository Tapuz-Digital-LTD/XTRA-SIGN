import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { sendInvitation, whatsappInvitation } from '@/server/invitations/invitations'

/** Send (or send again) the personal invitation: SMS or email now, or the WhatsApp share to confirm. */
export async function POST(request: Request, context: { params: Promise<{ leadId: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { leadId } = await context.params
    const body = (await request.json().catch(() => null)) as { channel?: unknown } | null
    const channel = body?.channel
    if (channel === 'whatsapp') {
      const share = await whatsappInvitation(session, leadId)
      if (!share.ok) return NextResponse.json({ error: { message: share.message } }, { status: 400 })
      return NextResponse.json({ ok: true, whatsapp: { sendId: share.sendId, url: share.url, text: share.text } })
    }
    if (channel !== 'sms' && channel !== 'email') return NextResponse.json({ error: { message: 'בחרו ערוץ.' } }, { status: 400 })
    const sent = await sendInvitation(session, leadId, channel)
    if (!sent.ok) return NextResponse.json({ error: { message: sent.message } }, { status: 400 })
    return NextResponse.json({ ok: true, sendId: sent.sendId })
  } catch (error) {
    return templateFailure(error)
  }
}
