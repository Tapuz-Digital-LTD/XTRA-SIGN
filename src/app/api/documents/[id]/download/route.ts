import { NextResponse } from 'next/server'
import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { authorizeVersionFileAccess } from '@/server/documents/authorization'
import { getStorage } from '@/server/storage/blob'

const PURPOSES = ['source', 'rendered', 'signed'] as const
type Purpose = (typeof PURPOSES)[number]

/**
 * Hands back a short-lived signed URL rather than proxying the bytes.
 *
 * Authorization runs first and the storage key is resolved from the authorized
 * agreement — the caller never names a key. The URL that comes back expires in
 * minutes, so it cannot outlive the check that produced it.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params

    const requested = new URL(request.url).searchParams.get('type') ?? 'rendered'
    const purpose: Purpose = (PURPOSES as readonly string[]).includes(requested)
      ? (requested as Purpose)
      : 'rendered'

    const { key, agreementTitle } = await authorizeVersionFileAccess(session, id, purpose)

    const url = await getStorage().signedDownloadUrl(key, {
      expiresInSeconds: 120,
      downloadFilename: `${agreementTitle}.pdf`,
    })

    // 302 rather than a JSON body: the browser follows it straight to storage,
    // and the URL never has to be handled by client script.
    return NextResponse.redirect(url, 302)
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    // Not-found and not-yours deliberately share one response, so the endpoint
    // cannot be used to discover which ids exist.
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
    }
    throw error
  }
}
