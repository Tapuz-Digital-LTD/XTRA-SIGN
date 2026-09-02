import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { resolveOwnCompanyId } from '@/server/companies/companies'
import { createComposedDocument } from '@/server/documents/compose'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { clientIp, log } from '@/server/log'

/** A document typed into the composer, turned into a draft. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    // The same budget as an upload: this creates a document just the same.
    const gate = await consume('upload', session.userId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'נוצרו יותר מדי מסמכים. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | { title?: unknown; text?: unknown; companyId?: unknown }
      | null
    if (!body || typeof body.title !== 'string' || typeof body.text !== 'string') {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    // A client-supplied company id is never trusted: it is confirmed to belong
    // to this organization, and dropped if not.
    const companyId = await resolveOwnCompanyId(
      session,
      typeof body.companyId === 'string' ? body.companyId : null,
    )

    const result = await createComposedDocument({
      session,
      title: body.title,
      text: body.text,
      companyId,
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })

    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }

    return NextResponse.json({ agreementId: result.agreementId, pageCount: result.pageCount })
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    log.error('compose failed', {
      error: error instanceof Error ? error.message : String(error),
    })
    return NextResponse.json(
      { error: { message: 'יצירת המסמך נכשלה בצד השרת. נסו שוב.' } },
      { status: 500 },
    )
  }
}
