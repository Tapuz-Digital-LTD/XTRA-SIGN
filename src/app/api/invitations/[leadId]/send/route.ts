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
    const body = (await request.json().catch(() => null)) as { channel?: unknown; attemptKey?: unknown; force?: unknown } | null
    const channel = body?.channel
    // Every send goes through the dispatcher: permission, eligibility, the
    // do-not-contact list, the rate limit, the 24-hour cooldown, and one
    // reservation per attempt key. `force` is honoured for admins only, audited.
    const options = { attemptKey: typeof body?.attemptKey === 'string' ? body.attemptKey : null, force: body?.force === true }
    const status = (state: string) => (state === 'cooldown' || state === 'suppressed' ? 409 : state === 'rate_limited' ? 429 : state === 'forbidden' ? 403 : state === 'not_found' ? 404 : 400)
    if (channel === 'whatsapp') {
      const share = await whatsappInvitation(session, leadId, options)
      if (!share.ok) return NextResponse.json({ error: { message: share.message }, state: share.state }, { status: status(share.state) })
      return NextResponse.json({ ok: true, whatsapp: { sendId: share.sendId, url: share.url, text: share.text } })
    }
    if (channel !== 'sms' && channel !== 'email') return NextResponse.json({ error: { message: 'בחרו ערוץ.' } }, { status: 400 })
    const sent = await sendInvitation(session, leadId, channel, options)
    if (!sent.ok) return NextResponse.json({ error: { message: sent.message }, state: sent.state }, { status: status(sent.state), headers: sent.retryAfter ? { 'Retry-After': String(sent.retryAfter) } : undefined })
    return NextResponse.json({ ok: true, sendId: sent.sendId, state: sent.state })
  } catch (error) {
    return templateFailure(error)
  }
}
