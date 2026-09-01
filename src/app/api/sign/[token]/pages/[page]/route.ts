import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb, schema } from '@/server/db'
import { parsePageNumber, previewHeaders } from '@/server/documents/preview'
import { pageImageKey } from '@/server/documents/process-document'
import { resolveSigningToken } from '@/server/signing/session'
import { getStorage } from '@/server/storage/s3'

/**
 * A page image for the signer.
 *
 * The signing token is the authorization: it names exactly one recipient and
 * one document, and the storage key is derived from that — never supplied.
 * Deliberately available before OTP, so the signer can read what they are being
 * asked to verify their phone for.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string; page: string }> },
) {
  const { token, page: pageParam } = await context.params
  const signing = await resolveSigningToken(token)
  if (!signing) return notAvailable()

  const db = getDb()
  const [version] = await db
    .select({ pageCount: schema.agreementVersions.pageCount })
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, signing.versionId))
    .limit(1)

  const page = parsePageNumber(pageParam, version?.pageCount ?? null)
  if (page === null) return notAvailable()

  try {
    const bytes = await getStorage().get(
      pageImageKey(
        {
          organizationId: signing.organizationId,
          agreementId: signing.agreementId,
          versionId: signing.versionId,
        },
        page,
      ),
    )
    return new NextResponse(new Uint8Array(bytes), { headers: previewHeaders('image/png') })
  } catch {
    return notAvailable()
  }
}

function notAvailable() {
  return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
}
