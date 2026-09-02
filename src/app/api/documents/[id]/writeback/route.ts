import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { writeBackSignedDocument } from '@/server/crm/writeback'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** Retries pushing the signed PDF back to its CRM record. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    await authorizeAgreementAccess(session, id)

    const result = await writeBackSignedDocument(id)
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: { message: result.message ?? 'ההעלאה נכשלה.' } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
