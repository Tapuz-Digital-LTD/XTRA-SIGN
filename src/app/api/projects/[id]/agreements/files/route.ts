import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { signedCampaignFiles } from '@/server/documents/campaign-files'
import type { ListFilter } from '@/server/documents/queries'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'
import { isCallVersion } from '@/server/self-service/call-version'
import { AUDIT_EVENTS, recordAdminAction } from '@/server/users/admin-audit'

const FILTERS: ListFilter[] = ['attention', 'signed', 'pending', 'expired', 'canceled']

/**
 * The signed files behind the agreements tab as it is filtered, for the ZIP
 * the browser builds. Only the list comes from here — each file is then
 * fetched through /api/documents/[id]/file, which authorizes it on its own,
 * so a function never holds a whole campaign's PDFs (or hits the response
 * size limit). The request itself is the download, and is recorded as one.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const gate = await consume('upload', `${session.userId}:export`)
    if (!gate.allowed) return NextResponse.json({ error: { message: 'יותר מדי ייצואים בזמן קצר. נסו שוב בעוד כמה דקות.' } }, { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } })
    const body = (await request.json().catch(() => null)) as { filter?: unknown; call?: unknown } | null
    const filter = FILTERS.find((f) => f === body?.filter)
    const callVersion = isCallVersion(body?.call) ? body.call : undefined

    const files = await signedCampaignFiles(session, id, { filter, callVersion })
    await recordAdminAction({
      organizationId: session.organizationId,
      type: AUDIT_EVENTS.AGREEMENTS_DOWNLOADED,
      actorEmail: session.email,
      metadata: { groupId: id, filter: filter ?? 'all', callVersion: callVersion ?? null, count: files.length, agreementIds: files.map((f) => f.id) },
    })
    return NextResponse.json({ files })
  } catch (error) {
    return templateFailure(error)
  }
}
