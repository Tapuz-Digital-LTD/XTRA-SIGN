import { NextResponse } from 'next/server'
import { attentionDetail } from '@/server/attention/attention'
import { requireSession } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { templateFailure } from '@/server/http/template-errors'

/** The drawer: why this document needs a person, and every attempt made so far. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const agreement = await authorizeAgreementAccess(session, id)
    return NextResponse.json(await attentionDetail(session.organizationId, agreement.id))
  } catch (error) {
    return templateFailure(error)
  }
}
