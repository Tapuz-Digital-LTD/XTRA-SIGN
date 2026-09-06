import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { templateFailure } from '@/server/http/template-errors'
import { registrationDetail } from '@/server/reports/registration-actions'

/** One registration's whole story: the business, the submission, the agreement, the timeline. */
export async function GET(_request: Request, context: { params: Promise<{ id: string; leadId: string }> }) {
  try {
    const session = await requireSession()
    const { id, leadId } = await context.params
    const detail = await registrationDetail(session, id, leadId)
    if (!detail) return NextResponse.json({ error: { message: 'ההרשמה לא נמצאה.' } }, { status: 404 })
    return NextResponse.json(detail)
  } catch (error) {
    return templateFailure(error)
  }
}
