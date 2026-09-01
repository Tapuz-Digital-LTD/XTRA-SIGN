import { eq } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getDb, schema } from '@/server/db'
import { resolveSigningToken } from '@/server/signing/session'
import { getStorage } from '@/server/storage/s3'

/**
 * The signer's copy of the signed document.
 *
 * Their link stays usable for this after signing — the spec is explicit that
 * nobody is forced to log in to get their own copy. Served as a short-lived
 * signed URL, so storage stays private.
 */
export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  const { token } = await context.params
  const signing = await resolveSigningToken(token)
  if (!signing) return unavailable()

  const db = getDb()
  const [version] = await db
    .select({ signedFileKey: schema.agreementVersions.signedFileKey })
    .from(schema.agreementVersions)
    .where(eq(schema.agreementVersions.id, signing.versionId))
    .limit(1)

  if (!version?.signedFileKey) return unavailable()

  const url = await getStorage().signedDownloadUrl(version.signedFileKey, {
    expiresInSeconds: 120,
    downloadFilename: `${signing.title}.pdf`,
  })

  return NextResponse.redirect(url, 302)
}

function unavailable() {
  return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
}
