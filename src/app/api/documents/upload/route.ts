import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { buildStorageKey, MAX_FILE_BYTES } from '@/server/documents/file-validation'
import { adoptUploadedDocument } from '@/server/documents/upload-document'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { consume } from '@/server/http/rate-limit'
import { clientIp } from '@/server/log'
import { presignUpload } from '@/server/storage/blob'

/**
 * Two steps, because the file never passes through a function.
 *
 *   POST { step: 'presign' }  → a short-lived URL the browser PUTs the file to
 *   POST { step: 'adopt' }    → we fetch the leading bytes, validate, and only
 *                               then create the agreement
 *
 * The split keeps a 25MB upload off the request path entirely. It also means
 * the constraints Blob enforces on the presigned URL — size and declared
 * content type — are a first line only: the Content-Type is whatever the
 * browser said, so the real check is on the bytes, after the fact. A file that
 * fails it is deleted rather than left in the store.
 */

const ACCEPTED_TYPES = ['application/pdf']

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

    const body = (await request.json().catch(() => null)) as
      | { step?: string; key?: string; filename?: string }
      | null

    if (body?.step === 'presign') {
      // The key is generated here and carries the tenant prefix, so the browser
      // never chooses where its file lands.
      const key = buildStorageKey({
        organizationId: session.organizationId,
        agreementId: crypto.randomUUID(),
        purpose: 'source',
        ext: 'pdf',
      })

      const url = await presignUpload({
        key,
        maxBytes: MAX_FILE_BYTES,
        contentTypes: ACCEPTED_TYPES,
      })

      return NextResponse.json({ key, url })
    }

    if (body?.step === 'adopt') {
      if (typeof body.key !== 'string') {
        return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
      }

      // The key must be one we issued for THIS organization. Without this a
      // caller could adopt an object belonging to another tenant.
      if (!body.key.startsWith(`org/${session.organizationId}/`)) {
        return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
      }

      const result = await adoptUploadedDocument({
        session,
        key: body.key,
        filename: typeof body.filename === 'string' ? body.filename : 'מסמך.pdf',
        ip: clientIp(request),
        userAgent: request.headers.get('user-agent'),
      })

      if (!result.ok) {
        return NextResponse.json({ error: { message: result.message } }, { status: 400 })
      }

      return NextResponse.json({ agreementId: result.agreementId, pageCount: result.pageCount })
    }

    return NextResponse.json({ error: { message: 'בקשה לא תקינה.' } }, { status: 400 })
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    throw error
  }
}
