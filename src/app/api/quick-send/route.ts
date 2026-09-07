import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'
import { clientIp } from '@/server/log'
import { quickSend, type QuickSendRecipient } from '@/server/quick-send/quick-send'

/** "שלח מסמך לחתימה" from the home page: recipient, template, channel — one call. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    // Creates a document, so it spends the same budget an upload does.
    const gate = await consume('upload', session.userId)
    if (!gate.allowed) return NextResponse.json({ error: { message: 'נשלחו יותר מדי מסמכים. נסו שוב מאוחר יותר.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    const body = (await request.json().catch(() => null)) as { recipient?: Record<string, unknown>; templateId?: unknown; channel?: unknown } | null
    const r = body?.recipient
    let recipient: QuickSendRecipient | null = null
    if (r && typeof r.companyId === 'string') recipient = { companyId: r.companyId }
    else if (r && typeof r.name === 'string' && (r.kind === 'supplier' || r.kind === 'customer')) recipient = { name: r.name, phone: typeof r.phone === 'string' ? r.phone : null, email: typeof r.email === 'string' ? r.email : null, kind: r.kind }
    const channel = body?.channel === 'sms' || body?.channel === 'email' || body?.channel === 'whatsapp' ? body.channel : null
    if (!recipient || typeof body?.templateId !== 'string' || !channel) return NextResponse.json({ error: { message: 'חסרים פרטים: נמען, מסמך וערוץ.' } }, { status: 400 })
    const result = await quickSend(session, { recipient, templateId: body.templateId, channel, ip: clientIp(request), userAgent: request.headers.get('user-agent') })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json(result)
  } catch (error) {
    return templateFailure(error)
  }
}
