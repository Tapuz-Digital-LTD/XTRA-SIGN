import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { clientIp } from '@/server/log'
import { createDocumentFromTemplate } from '@/server/templates/templates'
import { templateFailure } from '@/server/http/template-errors'

/** A new draft from a template. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    // Creates a document, so it spends the same budget an upload does.
    const gate = await consume('upload', session.userId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'נוצרו יותר מדי מסמכים. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const result = await createDocumentFromTemplate({
      session,
      templateId: id,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }
    return NextResponse.json({ agreementId: result.agreementId })
  } catch (error) {
    return templateFailure(error)
  }
}
