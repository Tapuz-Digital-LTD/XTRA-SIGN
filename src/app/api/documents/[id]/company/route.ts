import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { setDocumentCompany } from '@/server/documents/company-link'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** Files a document under a supplier or customer, or detaches it. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const body = (await request.json().catch(() => null)) as { companyId?: unknown } | null
    const companyId =
      body?.companyId === null ? null : typeof body?.companyId === 'string' ? body.companyId : undefined
    if (companyId === undefined) {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const result = await setDocumentCompany({ session, agreementId: id, companyId })
    return result.ok
      ? NextResponse.json({ ok: true, companyName: result.companyName })
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
