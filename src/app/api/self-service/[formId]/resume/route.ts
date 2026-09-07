import { NextResponse } from 'next/server'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { clientIp } from '@/server/log'
import { findSelfServiceProjectByFormId } from '@/server/projects/self-service'
import { resumeSigning } from '@/server/self-service/resume'

/**
 * "המשך חתימה": a fresh link and a new phone code for an agreement that
 * already exists — by an expired link's token, or by the registration's
 * stable id. Rate-limited like any code send; never creates anything.
 */
export async function POST(request: Request, context: { params: Promise<{ formId: string }> }) {
  try {
    assertSameOrigin(request)
    const { formId } = await context.params
    const project = await findSelfServiceProjectByFormId(formId)
    if (!project) return NextResponse.json({ error: { message: 'הקמפיין לא נמצא.' } }, { status: 404 })
    const gate = await consume('otpSend', clientIp(request) ?? 'unknown')
    if (!gate.allowed) return NextResponse.json({ error: { message: 'נשלחו יותר מדי קודים. נסו שוב בעוד כמה דקות.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    const body = (await request.json().catch(() => null)) as { token?: unknown; registrationId?: unknown } | null
    const token = typeof body?.token === 'string' ? body.token : undefined
    const registrationId = typeof body?.registrationId === 'string' && /^[0-9a-f-]{36}$/i.test(body.registrationId) ? body.registrationId : undefined
    if (!token && !registrationId) return NextResponse.json({ error: { message: 'חסר מזהה.' } }, { status: 400 })
    const result = await resumeSigning(project, { token, registrationId })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: result.closed ? 410 : 404 })
    return NextResponse.json(result)
  } catch (error) {
    return NextResponse.json({ error: { message: error instanceof Error ? error.message : 'הפעולה נכשלה.' } }, { status: 400 })
  }
}
