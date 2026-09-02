import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { syncFromFireberry } from '@/server/crm/sync'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { log } from '@/server/log'

/** Manually pull suppliers and customers from Fireberry (read-only upsert). */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    const gate = await consume('userCreate', `crmsync:${session.organizationId}`)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'הסנכרון בוצע לאחרונה. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const result = await syncFromFireberry(session)
    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }
    return NextResponse.json({ ok: true, counts: result.counts, errors: result.errors })
  } catch (error) {
    if (error instanceof CsrfError) return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    log.error('crm sync failed', { error: error instanceof Error ? error.message : String(error) })
    return NextResponse.json({ error: { message: 'הסנכרון נכשל בצד השרת.' } }, { status: 500 })
  }
}
