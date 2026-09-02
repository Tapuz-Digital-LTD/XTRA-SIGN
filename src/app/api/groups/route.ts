import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { createGroup, listGroups } from '@/server/groups/groups'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

export async function GET() {
  try {
    const session = await requireSession()
    return NextResponse.json({ ok: true, groups: await listGroups(session) })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as
      | { name?: unknown; description?: unknown; companyIds?: unknown }
      | null

    const result = await createGroup({
      session,
      name: String(body?.name ?? ''),
      description: typeof body?.description === 'string' ? body.description : null,
      companyIds: Array.isArray(body?.companyIds)
        ? (body.companyIds.filter((c) => typeof c === 'string') as string[])
        : undefined,
    })
    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
