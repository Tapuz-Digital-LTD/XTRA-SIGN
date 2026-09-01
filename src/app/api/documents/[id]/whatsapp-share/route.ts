import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { AUDIT_EVENTS } from '@/server/audit'
import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { getDb, schema } from '@/server/db'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'

/**
 * Records that the WhatsApp share sheet was opened.
 *
 * NOT that a message was sent. WhatsApp is a client-side share: the user picks
 * a contact and presses send inside WhatsApp, which this system cannot observe.
 * There is deliberately no Delivery row here — a Delivery asserts a provider
 * accepted a message, and nothing here can assert that.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const agreement = await authorizeAgreementAccess(session, id)

    const db = getDb()
    const [recipient] = await db
      .select({ id: schema.recipients.id })
      .from(schema.recipients)
      .where(eq(schema.recipients.agreementId, agreement.id))
      .limit(1)

    await db.insert(schema.auditEvents).values({
      agreementId: agreement.id,
      recipientId: recipient?.id ?? null,
      type: AUDIT_EVENTS.WHATSAPP_SHARE_OPENED,
      actor: session.email,
    })

    return NextResponse.json({ ok: true })
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
