import { NextResponse } from 'next/server'
import { requireSession } from '@/server/auth/session'
import { renderComposedDocument } from '@/server/documents/composer-render'
import { processDocumentVersion } from '@/server/documents/process-document'
import { saveFields } from '@/server/documents/save-fields'
import { uploadDocument } from '@/server/documents/upload-document'
import { assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { templateFailure } from '@/server/http/template-errors'
import { clientIp, log } from '@/server/log'

const MAX_HTML = 500_000

/** Turns an authored document into a real one, fields and all. */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
    const session = await requireSession()

    const gate = await consume('upload', session.userId)
    if (!gate.allowed) {
      return NextResponse.json(
        { error: { message: 'נוצרו יותר מדי מסמכים. נסו שוב מאוחר יותר.' } },
        { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
      )
    }

    const body = (await request.json().catch(() => null)) as
      | { title?: unknown; html?: unknown; companyId?: unknown }
      | null

    const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 200) : ''
    const html = typeof body?.html === 'string' ? body.html : ''
    const companyId = typeof body?.companyId === 'string' ? body.companyId : null

    if (!title) return NextResponse.json({ error: { message: 'יש להזין שם למסמך.' } }, { status: 400 })
    if (!companyId) return NextResponse.json({ error: { message: 'יש לבחור ספק או לקוח.' } }, { status: 400 })
    if (!html.trim()) return NextResponse.json({ error: { message: 'יש להזין את תוכן המסמך.' } }, { status: 400 })
    if (html.length > MAX_HTML) {
      return NextResponse.json({ error: { message: 'המסמך ארוך מדי.' } }, { status: 400 })
    }

    let rendered
    try {
      rendered = await renderComposedDocument(html)
    } catch (error) {
      log.error('composer render failed', { error: String(error) })
      return NextResponse.json({ error: { message: 'ההמרה ל-PDF נכשלה.' } }, { status: 400 })
    }

    const uploaded = await uploadDocument({
      session,
      buffer: rendered.pdf,
      filename: `${title}.pdf`,
      companyId,
      sourceKind: 'composed',
      origin: { composed: true },
      ip: clientIp(request),
      userAgent: request.headers.get('user-agent'),
    })
    if (!uploaded.ok) {
      return NextResponse.json({ error: { message: uploaded.message } }, { status: 400 })
    }

    const processed = await processDocumentVersion({
      agreementId: uploaded.agreementId,
      organizationId: session.organizationId,
      versionId: uploaded.versionId,
      actor: session.email,
    })
    if (!processed.ok) {
      return NextResponse.json({ error: { message: processed.message } }, { status: 400 })
    }

    if (rendered.fields.length > 0) {
      const saved = await saveFields({ session, agreementId: uploaded.agreementId, fields: rendered.fields })
      if (!saved.ok) {
        // The document exists; say plainly that the fields did not make it
        // rather than leaving a half-made draft to be discovered later.
        return NextResponse.json(
          { ok: true, agreementId: uploaded.agreementId, warning: `המסמך נוצר, אך השדות לא נשמרו: ${saved.message}` },
        )
      }
    }

    return NextResponse.json({ ok: true, agreementId: uploaded.agreementId, fields: rendered.fields.length })
  } catch (error) {
    return templateFailure(error)
  }
}
