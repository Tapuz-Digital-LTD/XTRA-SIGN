import { NextResponse } from 'next/server'
import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { cancelAgreement, createNewVersion, duplicateAgreement } from '@/server/documents/lifecycle'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'

/** Cancel, duplicate, or start a new version of a document. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const gate = await consume('upload', session.userId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'יותר מדי פעולות. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as { action?: string } | null
    const action = body?.action

    if (action === 'cancel') {
      const result = await cancelAgreement({ session, agreementId: id })
      return result.ok
        ? NextResponse.json({ ok: true })
        : NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }

    if (action === 'duplicate' || action === 'new-version') {
      const result =
        action === 'duplicate'
          ? await duplicateAgreement({ session, agreementId: id })
          : await createNewVersion({ session, agreementId: id })
      return result.ok
        ? NextResponse.json({ ok: true, id: result.id })
        : NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }

    return NextResponse.json({ error: { message: 'פעולה לא תקינה.' } }, { status: 400 })
  } catch (error) {
    if (error instanceof CsrfError) return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    if (error instanceof UnauthorizedError) return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    if (error instanceof ForbiddenError) return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
    throw error
  }
}
