import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { planBulkSend, runBulkSend } from '@/server/groups/bulk-send'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** The plan: who would be sent to, and who could not be. Writes nothing. */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    const templateId = new URL(request.url).searchParams.get('template')
    if (!templateId) return NextResponse.json({ error: { message: 'לא נבחרה תבנית.' } }, { status: 400 })

    return NextResponse.json({ ok: true, ...(await planBulkSend({ session, groupId: id, templateId })) })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Runs the send, or retries an existing batch. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as
      | { templateId?: unknown; companyIds?: unknown; batchId?: unknown }
      | null

    if (typeof body?.templateId !== 'string') {
      return NextResponse.json({ error: { message: 'לא נבחרה תבנית.' } }, { status: 400 })
    }

    const result = await runBulkSend({
      session,
      groupId: id,
      templateId: body.templateId,
      companyIds: Array.isArray(body.companyIds)
        ? (body.companyIds.filter((c) => typeof c === 'string') as string[])
        : [],
      batchId: typeof body.batchId === 'string' ? body.batchId : undefined,
    })
    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    return templateFailure(error)
  }
}
