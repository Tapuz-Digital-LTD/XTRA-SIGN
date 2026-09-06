import { NextResponse } from 'next/server'
import { requireAdmin, requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'
import { publicBaseUrl } from '@/server/http/public-url'
import { brandFor } from '@/server/mail/brand'
import { isMailTemplateKey, renderSample } from '@/server/mail/catalog'
import { InforuEmailProvider } from '@/server/notifications/inforu'

/**
 * Sends one template with sample data to an address the admin types. A test
 * is a normal send with a "[בדיקה]" subject — Inforu has no separate test
 * API — and it touches no statistics of ours.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    requireAdmin(session)
    const gate = await consume('upload', session.userId)
    if (!gate.allowed) return NextResponse.json({ error: { message: 'נשלחו יותר מדי מיילי בדיקה. נסו שוב מאוחר יותר.' } }, { status: 429 })
    const body = (await request.json().catch(() => null)) as { template?: unknown; to?: unknown } | null
    const to = typeof body?.to === 'string' ? body.to.trim().toLowerCase() : ''
    if (!isMailTemplateKey(body?.template) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
      return NextResponse.json({ error: { message: 'יש לבחור תבנית ולהזין כתובת תקינה.' } }, { status: 400 })
    }
    const brand = await brandFor({ organizationId: session.organizationId })
    const rendered = await renderSample(body.template, brand, publicBaseUrl())
    const result = await new InforuEmailProvider().send({ to, subject: `[בדיקה] ${rendered.subject}`, text: rendered.text, html: rendered.html, recipientName: session.name })
    if (!result.ok) return NextResponse.json({ error: { message: `השליחה נכשלה (${result.error}).` } }, { status: 502 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
