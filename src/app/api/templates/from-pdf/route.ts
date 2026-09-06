import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { MAX_FILE_BYTES } from '@/server/documents/file-validation'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'
import { createTemplateFromPdf } from '@/server/templates/templates'

/**
 * A template from an uploaded PDF, in one request: multipart `file` + `name`.
 * The bytes go through the same validation an agreement upload does.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    const gate = await consume('upload', session.userId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'הועלו יותר מדי קבצים. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const form = await request.formData().catch(() => null)
    const file = form?.get('file')
    const name = form?.get('name')
    if (!(file instanceof File) || typeof name !== 'string') {
      return NextResponse.json({ error: { message: 'יש לבחור קובץ PDF ולתת לתבנית שם.' } }, { status: 400 })
    }
    if (file.size > MAX_FILE_BYTES) {
      return NextResponse.json({ error: { message: 'הקובץ גדול מדי. הגודל המרבי הוא 25MB.' } }, { status: 413 })
    }

    const result = await createTemplateFromPdf({
      session,
      buffer: Buffer.from(await file.arrayBuffer()),
      name,
    })
    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }
    return NextResponse.json({ templateId: result.templateId, fieldCount: result.fieldCount })
  } catch (error) {
    return templateFailure(error)
  }
}
