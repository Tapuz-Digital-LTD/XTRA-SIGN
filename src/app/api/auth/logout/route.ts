import { NextResponse } from 'next/server'
import { destroySession } from '@/server/auth/session'
import { CsrfError, assertSameOrigin } from '@/server/http/csrf'

/**
 * POST only. A logout on GET is CSRF-triggerable from any page that can embed
 * an image, which is a nuisance rather than a breach, but there is no reason to
 * allow it.
 */
export async function POST(request: Request) {
  try {
    assertSameOrigin(request)
  } catch (error) {
    if (error instanceof CsrfError) {
      return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
    }
    throw error
  }

  await destroySession()
  return NextResponse.redirect(new URL('/login', request.url), 303)
}
