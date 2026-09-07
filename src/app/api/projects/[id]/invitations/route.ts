import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { createInvitation, findInvitees, normalizeContact, sendInvitation, whatsappInvitation, type AudienceKind } from '@/server/invitations/invitations'

/** Who already has this phone or email in the campaign — asked before a second invitation goes out. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const url = new URL(request.url)
    const contact = normalizeContact({ phone: url.searchParams.get('phone') ?? '', email: url.searchParams.get('email') ?? '' })
    if (!contact.ok) return NextResponse.json({ existing: [] })
    return NextResponse.json({ existing: await findInvitees(session, id, contact.contact) })
  } catch (error) {
    return templateFailure(error)
  }
}

/** "שליחת הזמנה": name, phone or email, channel — one row, one message. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { name?: unknown; phone?: unknown; email?: unknown; kind?: unknown; channel?: unknown; companyId?: unknown } | null
    if (!body || typeof body.name !== 'string') return NextResponse.json({ error: { message: 'נדרש שם.' } }, { status: 400 })
    const channel = body.channel === 'sms' || body.channel === 'email' || body.channel === 'whatsapp' ? body.channel : null
    const kind: AudienceKind | null = body.kind === 'supplier' || body.kind === 'customer' ? body.kind : null
    const created = await createInvitation(session, { groupId: id, name: body.name, phone: typeof body.phone === 'string' ? body.phone : null, email: typeof body.email === 'string' ? body.email : null, kind, companyId: typeof body.companyId === 'string' ? body.companyId : null })
    if (!created.ok) return NextResponse.json({ error: { message: created.message } }, { status: 400 })
    if (!channel) return NextResponse.json({ ok: true, invitation: created.invitation })
    if (channel === 'whatsapp') {
      const share = await whatsappInvitation(session, created.invitation.id)
      if (!share.ok) return NextResponse.json({ ok: true, invitation: created.invitation, send: { ok: false, message: share.message } })
      return NextResponse.json({ ok: true, invitation: created.invitation, whatsapp: { sendId: share.sendId, url: share.url, text: share.text } })
    }
    const sent = await sendInvitation(session, created.invitation.id, channel)
    return NextResponse.json({ ok: true, invitation: created.invitation, send: sent.ok ? { ok: true, sendId: sent.sendId } : { ok: false, message: sent.message } })
  } catch (error) {
    return templateFailure(error)
  }
}
