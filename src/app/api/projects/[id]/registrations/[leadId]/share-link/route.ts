import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { mintShareLink } from '@/server/reports/registration-actions'

/**
 * A personal link to hand over by hand — WhatsApp or the clipboard — with
 * the message already written. A share is not a send: it is recorded as
 * the share sheet opening, never as a delivery.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id, leadId } = await context.params
    const body = (await request.json().catch(() => null)) as { via?: unknown } | null
    const via = body?.via === 'whatsapp' ? 'whatsapp' : 'copy'
    const result = await mintShareLink(session, id, leadId, via)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json(result)
  } catch (error) {
    return templateFailure(error)
  }
}
