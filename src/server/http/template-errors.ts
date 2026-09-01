import { NextResponse } from 'next/server'
import { ForbiddenError, UnauthorizedError } from '@/server/auth/session'
import { CsrfError } from '@/server/http/csrf'

/**
 * One answer per failure class for the template routes. A route module may
 * only export HTTP methods, so this lives here rather than beside them.
 */
export function templateFailure(error: unknown): NextResponse {
  if (error instanceof CsrfError) {
    return NextResponse.json({ error: { message: 'הבקשה נדחתה.' } }, { status: 403 })
  }
  if (error instanceof UnauthorizedError) {
    return NextResponse.json({ error: { message: 'נדרשת התחברות.' } }, { status: 401 })
  }
  // Not-found and not-yours share one answer, so the route cannot be used to
  // discover which ids exist.
  if (error instanceof ForbiddenError) {
    return NextResponse.json({ error: { message: 'התבנית אינה זמינה.' } }, { status: 404 })
  }
  throw error
}
