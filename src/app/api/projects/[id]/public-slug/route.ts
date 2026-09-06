import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { getPublicSlugSettings, setPublicSlug } from '@/server/projects/public-slug'

/** A project's public address: read it with its history, or change it. */

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params
    return NextResponse.json(await getPublicSlugSettings(session, id))
  } catch (error) {
    return templateFailure(error)
  }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const body = (await request.json().catch(() => null)) as { slug?: unknown } | null
    if (!body || typeof body.slug !== 'string') {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }
    const result = await setPublicSlug(session, id, body.slug)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json(await getPublicSlugSettings(session, id))
  } catch (error) {
    return templateFailure(error)
  }
}
