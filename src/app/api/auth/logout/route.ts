import { NextResponse } from 'next/server'
import { destroySession } from '@/server/auth/session'

/**
 * POST only. A logout on GET is CSRF-triggerable from any page that can embed
 * an image, which is a nuisance rather than a breach, but there is no reason to
 * allow it.
 */
export async function POST(request: Request) {
  await destroySession()
  return NextResponse.redirect(new URL('/login', request.url), 303)
}
