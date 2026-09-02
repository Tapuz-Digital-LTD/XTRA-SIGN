import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { parseCanvasDocument, saveCanvasDocument } from '@/server/documents/canvas-save'
import { assertSameOrigin } from '@/server/http/csrf'
import { clientIp } from '@/server/log'
import { templateFailure } from '@/server/http/template-errors'

/** Saves a canvas document: renders its PDF and places its fields. */
export const maxDuration = 300

export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    const body = (await request.json().catch(() => null)) as {
      title?: unknown
      document?: unknown
      companyId?: unknown
    } | null

    const document = parseCanvasDocument(body?.document)
    if (!document) {
      return NextResponse.json({ error: { message: 'המסמך ריק או פגום.' } }, { status: 400 })
    }

    const result = await saveCanvasDocument({
      session,
      title: typeof body?.title === 'string' ? body.title : '',
      document,
      companyId: typeof body?.companyId === 'string' ? body.companyId : '',
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })

    return result.ok
      ? NextResponse.json(result)
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
