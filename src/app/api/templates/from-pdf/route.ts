import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { MAX_FILE_BYTES } from '@/server/documents/file-validation'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'
import { authorizeTemplateAccess, createTemplateFromPdf } from '@/server/templates/templates'
import { suggestRole, type AgreementRole } from '@/lib/agreement-roles'
import type { PlacedField } from '@/lib/fields'

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
    // The boxes found, each with a first guess at its role — for the person
    // to confirm on the next step, never saved by this call.
    const template = await authorizeTemplateAccess(session, result.templateId)
    const fields = Array.isArray(template.fields) ? (template.fields as PlacedField[]) : []
    const taken = new Set<AgreementRole>()
    const detected = fields.map((f) => {
      const suggestion = suggestRole(f, taken)
      if (suggestion) taken.add(suggestion)
      return { id: f.id, name: f.label, type: f.type, page: f.page, suggestion }
    })
    return NextResponse.json({ templateId: result.templateId, fieldCount: result.fieldCount, fields: detected })
  } catch (error) {
    return templateFailure(error)
  }
}
