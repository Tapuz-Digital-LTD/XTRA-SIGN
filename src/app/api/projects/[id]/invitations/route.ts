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

type Channel = 'sms' | 'email' | 'whatsapp'
/** SMS and email leave from here; WhatsApp only reserves and hands the rep a link, so it comes last. */
const CHANNELS: Channel[] = ['sms', 'email', 'whatsapp']
export type InvitationSend = { channel: Channel; to: string; ok: boolean; sendId?: string; state?: string; message?: string; whatsapp?: { sendId: string; url: string; text: string } }

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : typeof v === 'string' ? [v] : [])

/**
 * "שליחת הזמנה": one person, every door at once. One row, and then one
 * message per chosen channel per address it serves — SMS and WhatsApp to
 * every phone, email to every address — all on the same personal link.
 * Sends go one after another on purpose: a person holds one reservation
 * per channel at a time, and the provider is never asked twice for one
 * attempt. Each send answers for itself, so a number the provider refused
 * never hides the email that went out.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { name?: unknown; phone?: unknown; email?: unknown; phones?: unknown; emails?: unknown; kind?: unknown; channel?: unknown; channels?: unknown; companyId?: unknown; operationId?: unknown; force?: unknown; call?: unknown } | null
    if (!body || typeof body.name !== 'string') return NextResponse.json({ error: { message: 'נדרש שם.' } }, { status: 400 })
    const channels = [...new Set([...strings(body.channel), ...strings(body.channels)])].filter((c): c is Channel => (CHANNELS as string[]).includes(c))
    const kind: AudienceKind | null = body.kind === 'supplier' || body.kind === 'customer' ? body.kind : null
    const operationId = typeof body.operationId === 'string' && /^[A-Za-z0-9:_-]{8,120}$/.test(body.operationId) ? body.operationId : null
    if (!operationId) return NextResponse.json({ error: { message: 'חסר מזהה פעולה.' } }, { status: 400 })
    const created = await createInvitation(session, { groupId: id, operationId, name: body.name, phones: [...strings(body.phone), ...strings(body.phones)], emails: [...strings(body.email), ...strings(body.emails)], kind, companyId: typeof body.companyId === 'string' ? body.companyId : null, call: typeof body.call === 'string' ? body.call : null })
    if (!created.ok) return NextResponse.json({ error: { message: created.message } }, { status: 400 })

    const sends: InvitationSend[] = []
    for (const channel of CHANNELS) {
      if (!channels.includes(channel)) continue
      const targets = channel === 'email' ? created.invitation.points.emails : created.invitation.points.phones
      for (const [index, to] of targets.entries()) {
        // The same operation, channel and address: a retry finds its reservation instead of sending twice.
        const options = { attemptKey: `${operationId}:${channel}:${index}`, force: body.force === true, to }
        if (channel === 'whatsapp') {
          const share = await whatsappInvitation(session, created.invitation.id, options)
          sends.push(share.ok ? { channel, to, ok: true, sendId: share.sendId, whatsapp: { sendId: share.sendId, url: share.url, text: share.text } } : { channel, to, ok: false, message: share.message, state: share.state })
        } else {
          const sent = await sendInvitation(session, created.invitation.id, channel, options)
          sends.push(sent.ok ? { channel, to, ok: true, sendId: sent.sendId, state: sent.state } : { channel, to, ok: false, message: sent.message, state: sent.state })
        }
      }
    }
    return NextResponse.json({ ok: true, invitation: created.invitation, sends })
  } catch (error) {
    return templateFailure(error)
  }
}
