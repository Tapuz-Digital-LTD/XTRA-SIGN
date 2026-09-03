import { NextResponse } from 'next/server'
import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { authorizeVersionFileAccess } from '@/server/documents/authorization'
import { previewHeaders } from '@/server/documents/preview'
import { getStorage } from '@/server/storage/blob'

/**
 * The document itself, for pdf.js to render.
 *
 * Streamed through the app rather than handed out as a presigned URL: pdf.js
 * makes range requests and would need the URL to outlive them, and a URL that
 * lives long enough for that is one that can be copied out of the page. The
 * bytes go out only after the same authorization check every other document
 * route performs, and the caller never names a storage key.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params

    // Once a document is signed, THIS is the document — the signature is baked
    // into the file. Before that, the rendered file the signer will be shown.
    let file
    try {
      file = await authorizeVersionFileAccess(session, id, 'signed')
    } catch {
      file = await authorizeVersionFileAccess(session, id, 'rendered')
    }
    const { key, agreementTitle } = file
    const bytes = await getStorage().get(key)

    return new NextResponse(new Uint8Array(bytes), {
      headers: previewHeaders('application/pdf', `${agreementTitle}.pdf`),
    })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    // Not-found and not-yours share one answer, so the route cannot be used to
    // discover which ids exist.
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
    }
    return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
  }
}
