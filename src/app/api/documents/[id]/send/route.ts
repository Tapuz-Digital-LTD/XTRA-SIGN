import { NextResponse } from 'next/server'
import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { sendAgreement } from '@/server/documents/send-agreement'
import type { Channel } from '@/server/documents/send-validation'

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const body = (await request.json().catch(() => null)) as { channels?: unknown } | null
    const channels = (Array.isArray(body?.channels) ? body.channels : []).filter(
      (c): c is Channel => c === 'email' || c === 'sms',
    )

    const result = await sendAgreement({ session, agreementId: id, channels })

    if (!result.ok) {
      return NextResponse.json({ blockers: result.blockers }, { status: 400 })
    }

    // The signing URL IS returned, once, to the authenticated owner — the
    // WhatsApp share is the sender pasting this link themselves, so they have
    // to hold it. It is never persisted in raw form: only the hash is stored,
    // so the link cannot be recovered later. Sharing again means a resend,
    // which mints a fresh token.
    return NextResponse.json({
      ok: true,
      deliveries: result.deliveries,
      signingUrl: result.signingUrl,
    })
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
    }
    throw error
  }
}
