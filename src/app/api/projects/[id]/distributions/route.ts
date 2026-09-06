import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { createDistribution, listDistributions } from '@/server/distributions/distributions'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** The campaign's distributions, newest first. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    return NextResponse.json({ ok: true, distributions: await listDistributions(session, id) })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Save a new distribution as a draft with its recipients resolved. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = await request.json().catch(() => null)
    const result = await createDistribution(session, id, body)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true, id: result.id, stats: result.stats })
  } catch (error) {
    return templateFailure(error)
  }
}
