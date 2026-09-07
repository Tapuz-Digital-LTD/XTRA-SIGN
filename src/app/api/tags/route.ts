import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { createTag, listTags, parseTagKind } from '@/server/tags/tags'

/** The organization's tags of one kind, for pickers and filters. */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const kind = parseTagKind(new URL(request.url).searchParams.get('kind')) ?? 'company'
    return NextResponse.json({ ok: true, tags: await listTags(session, kind) })
  } catch (error) {
    return templateFailure(error)
  }
}

/** Create a tag — or get the existing one with this name. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const body = (await request.json().catch(() => null)) as Record<string, unknown> | null
    if (!body || typeof body.name !== 'string') return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })

    const result = await createTag(session, {
      name: body.name,
      kind: parseTagKind(body.kind) ?? 'company',
      color: typeof body.color === 'string' ? body.color : null,
    })
    return result.ok ? NextResponse.json({ ok: true, tag: result.tag }) : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
