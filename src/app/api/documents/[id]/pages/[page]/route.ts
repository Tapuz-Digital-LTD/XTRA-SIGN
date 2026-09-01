import { NextResponse } from 'next/server'
import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { authorizeAgreementAccess } from '@/server/documents/authorization'
import { parsePageNumber, previewHeaders } from '@/server/documents/preview'
import { pageImageKey } from '@/server/documents/process-document'
import { getDb, schema } from '@/server/db'
import { getStorage } from '@/server/storage/s3'
import { eq } from 'drizzle-orm'

/**
 * One page of a document, as a PNG, streamed through the app.
 *
 * Images rather than the PDF: the editor needs fixed pixel geometry to place
 * fields anyway, and a PNG cannot execute. No storage URL is handed out, and
 * the caller never names a key — it is derived from the authorized agreement
 * and its current version.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string; page: string }> },
) {
  try {
    const session = await requireSession()
    const { id, page: pageParam } = await context.params

    const agreement = await authorizeAgreementAccess(session, id)

    const db = getDb()
    const [version] = await db
      .select({
        id: schema.agreementVersions.id,
        pageCount: schema.agreementVersions.pageCount,
      })
      .from(schema.agreementVersions)
      .where(eq(schema.agreementVersions.id, agreement.currentVersionId ?? ''))
      .limit(1)

    if (!version) throw new ForbiddenError()

    const page = parsePageNumber(pageParam, version.pageCount)
    if (page === null) throw new ForbiddenError()

    const key = pageImageKey(
      {
        organizationId: agreement.organizationId,
        agreementId: agreement.id,
        versionId: version.id,
      },
      page,
    )

    const bytes = await getStorage().get(key)

    return new NextResponse(new Uint8Array(bytes), {
      headers: previewHeaders('image/png'),
    })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
    }
    // A missing object is a 404 too: distinguishing it would confirm the
    // agreement exists.
    return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
  }
}
