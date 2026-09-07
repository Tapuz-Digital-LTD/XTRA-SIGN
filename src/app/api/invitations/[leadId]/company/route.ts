import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { attachCompany } from '@/server/invitations/invitations'

/** "הוסף כספק/לקוח": link to a record the rep chose, or create a local one. Never the CRM. */
export async function POST(request: Request, context: { params: Promise<{ leadId: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { leadId } = await context.params
    const body = (await request.json().catch(() => null)) as { companyId?: unknown; kind?: unknown } | null
    const choice: Parameters<typeof attachCompany>[2] | null = typeof body?.companyId === 'string' ? { companyId: body.companyId } : body?.kind === 'supplier' || body?.kind === 'customer' ? { create: { kind: body.kind } } : null
    if (!choice) return NextResponse.json({ error: { message: 'בחרו רשומה קיימת או ספק/לקוח חדש.' } }, { status: 400 })
    const result = await attachCompany(session, leadId, choice)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true, companyId: result.companyId })
  } catch (error) {
    return templateFailure(error)
  }
}
