import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { deleteDraft } from '@/server/documents/lifecycle'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'

/** Deletes a draft. Sent and signed documents are cancelled, never removed. */
export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params

    const result = await deleteDraft({ session, agreementId: id })
    return result.ok
      ? NextResponse.json({ ok: true })
      : NextResponse.json({ error: { message: result.message } }, { status: 400 })
  } catch (error) {
    return templateFailure(error)
  }
}
