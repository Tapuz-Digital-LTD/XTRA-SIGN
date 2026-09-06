import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { sendDistribution } from '@/server/distributions/distributions'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** A test copy to one phone and/or one address — never to the audience. */
export async function POST(request: Request, context: { params: Promise<{ id: string; distributionId: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { distributionId } = await context.params
    const body = (await request.json().catch(() => ({}))) as { phone?: unknown; email?: unknown }
    const phone = typeof body.phone === 'string' && body.phone.trim() ? body.phone.trim() : undefined
    const email = typeof body.email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email.trim()) ? body.email.trim() : undefined
    const result = await sendDistribution(session, distributionId, { test: { phone, email } })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true })
  } catch (error) {
    return templateFailure(error)
  }
}
