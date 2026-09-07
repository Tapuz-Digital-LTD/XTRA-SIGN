import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { templateFailure } from '@/server/http/template-errors'
import { globalSearch } from '@/server/search/search'

/** The header search: a few hits per kind, under the caller's own visibility. */
export async function GET(request: Request) {
  try {
    const session = await requireSession()
    const q = new URL(request.url).searchParams.get('q') ?? ''
    return NextResponse.json({ ok: true, hits: await globalSearch(session, q.slice(0, 80)) })
  } catch (error) {
    return templateFailure(error)
  }
}
