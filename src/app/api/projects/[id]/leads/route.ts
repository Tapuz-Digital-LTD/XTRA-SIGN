import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { approveLead, listLeads, rejectLead, updateLead } from '@/server/projects/leads'

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    return NextResponse.json({ leads: await listLeads(session, id) })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Reviewing a lead: approve it into a supplier, correct it, or turn it away. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    await context.params
    const body = (await request.json().catch(() => null)) as
      | { action?: unknown; leadId?: unknown; values?: unknown; useExistingCompanyId?: unknown }
      | null

    const leadId = typeof body?.leadId === 'string' ? body.leadId : null
    if (!leadId) return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })

    const respond = (result: { ok: boolean; message?: string; companyId?: string }) =>
      result.ok
        ? NextResponse.json(result)
        : NextResponse.json({ error: { message: result.message } }, { status: 400 })

    if (body?.action === 'approve') {
      return respond(
        await approveLead(session, leadId, {
          useExistingCompanyId:
            typeof body.useExistingCompanyId === 'string' ? body.useExistingCompanyId : undefined,
        }),
      )
    }
    if (body?.action === 'reject') return respond(await rejectLead(session, leadId))
    if (body?.action === 'update') {
      return respond(
        await updateLead(session, leadId, (body.values ?? {}) as Record<string, unknown>),
      )
    }
    return NextResponse.json({ error: { message: 'פעולה לא מוכרת.' } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
