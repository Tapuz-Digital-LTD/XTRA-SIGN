import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { assertSameOrigin } from '@/server/http/csrf'
import { templateFailure } from '@/server/http/template-errors'
import { removeShareImage, saveShareImage } from '@/server/projects/share'

/** Upload (multipart `file`) or remove the share picture. */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    if (!(file instanceof File)) return NextResponse.json({ error: { message: 'לא נבחרה תמונה.' } }, { status: 400 })
    const result = await saveShareImage(session, id, { bytes: Buffer.from(await file.arrayBuffer()), type: file.type })
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true, settings: result.settings })
  } catch (error) {
    return templateFailure(error)
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()
    const { id } = await context.params
    const result = await removeShareImage(session, id)
    if (!result.ok) return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    return NextResponse.json({ ok: true, settings: result.settings })
  } catch (error) {
    return templateFailure(error)
  }
}
