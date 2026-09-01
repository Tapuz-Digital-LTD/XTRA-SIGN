import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { createTemplateFromAgreement } from '@/server/templates/templates'

/** Saves a document as a template. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    const body = (await request.json().catch(() => null)) as
      | { agreementId?: unknown; name?: unknown }
      | null
    if (!body || typeof body.agreementId !== 'string' || typeof body.name !== 'string') {
      return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
    }

    const result = await createTemplateFromAgreement({
      session,
      agreementId: body.agreementId,
      name: body.name,
    })
    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }

    return NextResponse.json({ templateId: result.templateId })
  } catch (error) {
    return templateFailure(error)
  }
}
