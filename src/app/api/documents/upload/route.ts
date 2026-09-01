import { NextResponse } from 'next/server'
import { requireSession, UnauthorizedError } from '@/server/auth/session'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { MAX_FILE_BYTES } from '@/server/documents/file-validation'
import { uploadDocument } from '@/server/documents/upload-document'
import { processDocumentVersion } from '@/server/documents/process-document'

export async function POST(request: Request) {
  let session
  try {
    // Before the session is even looked at: a mutation must prove where it came
    // from. SameSite=Lax alone does not establish that.
    assertSameOrigin(request)
    session = await requireSession()
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    throw error
  }

  const form = await request.formData()
  const file = form.get('file')

  if (!(file instanceof File)) {
    return NextResponse.json({ error: { message: 'לא נבחר קובץ.' } }, { status: 400 })
  }

  // Reject on the declared size before reading the body into memory. The real
  // check is on the actual bytes in validateUpload — this only avoids buffering
  // something huge first.
  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json(
      { error: { message: 'הקובץ גדול מדי. הגודל המרבי הוא 25MB.' } },
      { status: 413 },
    )
  }

  const buffer = Buffer.from(await file.arrayBuffer())

  const result = await uploadDocument({
    session,
    buffer,
    filename: file.name,
    ip: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
  })

  if (!result.ok) {
    return NextResponse.json({ error: { code: result.code, message: result.message } }, { status: 400 })
  }

  // Conversion runs inline for now: the MVP has one user at a time and an
  // honest "still preparing" state costs more than it buys. It moves to a queue
  // when concurrency justifies one.
  const processed = await processDocumentVersion({
    agreementId: result.agreementId,
    organizationId: session.organizationId,
    versionId: result.versionId,
    actor: session.email,
  })

  if (!processed.ok) {
    // The agreement and the original file are kept: the user can still download
    // what they uploaded, and retry or replace it.
    return NextResponse.json(
      { agreementId: result.agreementId, error: { message: processed.message } },
      { status: 422 },
    )
  }

  return NextResponse.json({
    agreementId: result.agreementId,
    pageCount: processed.pageCount,
  })
}
