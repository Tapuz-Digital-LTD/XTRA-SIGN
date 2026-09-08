import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { updateFollowUp } from '@/server/invitations/invitations'

/** Bulk follow-up: the same assignee and/or call-back date on several people. Nothing else changes. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as { ids?: unknown; assigneeUserId?: unknown; followUpAt?: unknown } | null
    const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter((x): x is string => typeof x === 'string'))].slice(0, 500) : []
    if (ids.length === 0) return NextResponse.json({ error: { message: 'לא נבחר אף אחד.' } }, { status: 400 })
    const patch: Parameters<typeof updateFollowUp>[2] = {}
    if ('assigneeUserId' in (body ?? {})) patch.assigneeUserId = typeof body?.assigneeUserId === 'string' && body.assigneeUserId ? body.assigneeUserId : null
    if ('followUpAt' in (body ?? {})) patch.followUpAt = typeof body?.followUpAt === 'string' && body.followUpAt ? body.followUpAt : null
    if (Object.keys(patch).length === 0) return NextResponse.json({ error: { message: 'בחרו אחראי או תאריך חזרה.' } }, { status: 400 })
    let updated = 0
    const failed: { id: string; message: string }[] = []
    for (const id of ids) {
      const result = await updateFollowUp(session, id, patch)
      if (result.ok) updated++
      else failed.push({ id, message: result.message })
    }
    return NextResponse.json({ updated, failed })
  } catch (error) {
    return templateFailure(error)
  }
}
