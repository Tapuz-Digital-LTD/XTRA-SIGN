import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb, schema } from '@/server/db'
import { previewHeaders } from '@/server/documents/preview'
import { resolveSigningToken } from '@/server/signing/session'
import { getStorage } from '@/server/storage/blob'

/**
 * The document, for the signer's pdf.js to render.
 *
 * The signing token is the authorization: it names exactly one recipient and
 * one document, and the storage key is derived from that — never supplied.
 * Available before the OTP on purpose, so the signer can read what they are
 * being asked to verify their phone for.
 */
export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const { token } = await context.params
  const signing = await resolveSigningToken(token)
  if (!signing) return notAvailable()

  const db = getDb()
  const [version] = await db
    .select({ renderedFileKey: schema.agreementVersions.renderedFileKey })
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, signing.versionId))
    .limit(1)

  if (!version?.renderedFileKey) return notAvailable()

  // A key must live under this agreement's organization prefix. If a row is
  // ever wrong, the tenant boundary still holds.
  if (!version.renderedFileKey.startsWith(`org/${signing.organizationId}/`)) return notAvailable()

  try {
    const bytes = await getStorage().get(version.renderedFileKey)
    return new NextResponse(new Uint8Array(bytes), {
      headers: previewHeaders('application/pdf', `${signing.title}.pdf`),
    })
  } catch {
    return notAvailable()
  }
}

function notAvailable() {
  return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
}
