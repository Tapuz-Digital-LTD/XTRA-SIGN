import { NextResponse } from 'next/server'
import { bulkResendFailed } from '@/server/attention/resend'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'

/**
 * "שלח שוב הודעות שנכשלו": with `preview: true`, how many of the chosen rows
 * can be sent as-is and why the rest cannot; without it, the sends.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as { agreementIds?: unknown; preview?: unknown } | null
    const agreementIds = Array.isArray(body?.agreementIds) ? body!.agreementIds.filter((v): v is string => typeof v === 'string') : []
    if (agreementIds.length === 0) return NextResponse.json({ error: { message: 'לא נבחרו הסכמים.' } }, { status: 400 })
    if (body?.preview === true) return NextResponse.json(await bulkResendFailed(session, { agreementIds, preview: true }))
    const gate = await consume('signingLink', `${session.userId}:bulk`)
    if (!gate.allowed) return NextResponse.json({ error: { message: 'נשלחו יותר מדי הודעות. נסו שוב מאוחר יותר.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    return NextResponse.json(await bulkResendFailed(session, { agreementIds, preview: false }))
  } catch (error) {
    return templateFailure(error)
  }
}
