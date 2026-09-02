import { ForbiddenError, requireSession, UnauthorizedError } from '@/server/auth/session'
import { buildAgreementCertificate } from '@/server/signing/certificate'
import { NextResponse } from 'next/server'

/**
 * The audit certificate for a signed agreement. Internal: it requires a staff
 * session with access to the document, and is never reachable through a signing
 * link. Generated on the fly and streamed as an attachment.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const session = await requireSession()
    const { id } = await context.params

    const result = await buildAgreementCertificate({ session, agreementId: id })
    if (!result.ok) {
      return NextResponse.json({ error: { message: result.message } }, { status: 400 })
    }

    const filename = encodeURIComponent(`אישור חתימה - ${result.title}.pdf`)
    return new NextResponse(new Uint8Array(result.pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename*=UTF-8''${filename}`,
        'Cache-Control': 'private, no-store, max-age=0',
      },
    })
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
    }
    if (error instanceof ForbiddenError) {
      return NextResponse.json({ error: { message: 'המסמך אינו זמין.' } }, { status: 404 })
    }
    throw error
  }
}
