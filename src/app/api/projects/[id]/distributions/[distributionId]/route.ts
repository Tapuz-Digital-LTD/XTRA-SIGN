import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { deleteDraftDistribution, getDistribution } from '@/server/distributions/distributions'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

export async function GET(_request: Request, context: { params: Promise<{ id: string; distributionId: string }> }) {
  try {
    const session = await requireSession()
    const { distributionId } = await context.params
    const distribution = await getDistribution(session, distributionId)
    if (!distribution) return NextResponse.json({ error: { message: 'ההפצה לא נמצאה.' } }, { status: 404 })
    return NextResponse.json({ ok: true, distribution })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Drafts only; a sent distribution is history. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; distributionId: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { distributionId } = await context.params
    const result = await deleteDraftDistribution(session, distributionId)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
