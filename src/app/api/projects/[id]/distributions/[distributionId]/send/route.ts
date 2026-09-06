import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { sendDistribution } from '@/server/distributions/distributions'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** Send to the audience. `override: true` (admins) ignores the 24-hour guard and is audited. */
export async function POST(request: Request, context: { params: Promise<{ id: string; distributionId: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { distributionId } = await context.params
    const body = (await request.json().catch(() => ({}))) as { override?: unknown }
    const result = await sendDistribution(session, distributionId, { override: body.override === true })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true, stats: result.stats, skippedRecent: result.skippedRecent })
  } catch (error) {
    return templateFailure(error)
  }
}
