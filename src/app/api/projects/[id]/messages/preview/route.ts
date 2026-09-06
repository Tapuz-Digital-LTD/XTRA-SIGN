import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { previewMessage } from '@/server/projects/messages'
import { DEFAULT_MESSAGES, type MessageEvent } from '@/lib/message-template'

/** What the message would say — with sample values, or a real registration's (`leadId`). */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { event?: unknown; override?: unknown; leadId?: unknown } | null
    const event = typeof body?.event === 'string' && body.event in DEFAULT_MESSAGES ? (body.event as MessageEvent) : null
    if (!event) return NextResponse.json({ error: { message: 'אירוע לא מוכר.' } }, { status: 400 })
    const preview = await previewMessage(session, id, { event, override: body?.override, leadId: typeof body?.leadId === 'string' ? body.leadId : null })
    if (!preview) return NextResponse.json({ error: { message: 'הקמפיין לא נמצא.' } }, { status: 404 })
    return NextResponse.json({ ok: true, ...preview })
  } catch (error) {
    return templateFailure(error)
  }
}
