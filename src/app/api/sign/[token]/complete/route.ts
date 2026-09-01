import { NextResponse } from 'next/server'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'
import { completeSigning } from '@/server/signing/complete'
import { hasVerifiedSession, isSignable, resolveSigningToken } from '@/server/signing/session'

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    assertSameOrigin(request)
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    throw error
  }

  const { token } = await context.params
  const signing = await resolveSigningToken(token)

  // A second submit on an already-signed document lands here and is refused —
  // the status has already left the open set.
  if (!signing || !isSignable(signing.status)) {
    return NextResponse.json({ error: { message: 'הקישור אינו זמין.' } }, { status: 404 })
  }

  if (signing.recipientPhone && !(await hasVerifiedSession(signing))) {
    return NextResponse.json({ error: { message: 'נדרש אימות טלפון.' } }, { status: 401 })
  }

  const body = (await request.json().catch(() => null)) as
    | { signature?: string; method?: string; consent?: string }
    | null

  if (!body?.signature || !body.consent) {
    return NextResponse.json({ error: { message: 'נתונים לא תקינים.' } }, { status: 400 })
  }

  const result = await completeSigning({
    context: signing,
    signatureDataUrl: body.signature,
    signatureMethod: body.method === 'typed' ? 'typed' : 'drawn',
    consentText: body.consent.slice(0, 500),
    ip: request.headers.get('x-forwarded-for'),
    userAgent: request.headers.get('user-agent'),
  })

  return result.ok
    ? NextResponse.json({ ok: true })
    : NextResponse.json({ error: { message: result.message } }, { status: 400 })
}
