import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { getMessageSettings, otpSample, saveMessageOverride } from '@/server/projects/messages'
import { DEFAULT_MESSAGES, type MessageEvent } from '@/lib/message-template'

/** The campaign's messages: defaults, overrides, the variables to pick from. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const settings = await getMessageSettings(session, id)
    if (!settings) return NextResponse.json({ error: { message: 'הקמפיין לא נמצא.' } }, { status: 404 })
    return NextResponse.json({ ok: true, ...settings, otp: otpSample() })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Save one event's words (`override: null` restores the default). */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { event?: unknown; override?: unknown } | null
    const event = typeof body?.event === 'string' && body.event in DEFAULT_MESSAGES ? (body.event as MessageEvent) : null
    if (!event) return NextResponse.json({ error: { message: 'אירוע לא מוכר.' } }, { status: 400 })
    const result = await saveMessageOverride(session, id, event, body?.override ?? null)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
