/**
 * Origin validation for state-changing requests.
 *
 * SameSite=Lax is a useful second layer, but it is NOT a complete CSRF defence
 * and must not be described as one:
 *
 *   - It is scoped to the registrable domain, so any sibling subdomain is
 *     "same-site". One compromised or XSS-able subdomain and Lax contributes
 *     nothing at all.
 *   - Chrome's "Lax-allowing-unsafe" grace period lets a cross-site POST carry
 *     a cookie set within the last two minutes — exactly the window right after
 *     someone logs in.
 *   - Cookies without an explicit SameSite are treated differently across
 *     browsers and versions, and a proxy or framework can drop the attribute.
 *   - It says nothing about a same-site attacker.
 *
 * So every state-changing entry point checks the Origin header as well. Origin
 * is attached by the browser to all POST/PUT/PATCH/DELETE requests and is on
 * the forbidden-header list — page script cannot forge it.
 *
 * Referer is the fallback for the rare client that omits Origin. A request with
 * neither is refused: for a mutation, "cannot tell where this came from" is a
 * rejection, not a pass.
 */

import { log } from '@/server/log'

export class CsrfError extends Error {
  readonly status = 403
  constructor(readonly reason: string) {
    super('csrf_check_failed')
  }
}

/** Hosts allowed to originate a mutation. */
export function allowedOrigins(): string[] {
  const configured = [
    process.env.SIGN_PUBLIC_URL,
    ...(process.env.SIGN_EXTRA_ORIGINS?.split(',') ?? []),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))

  return configured
    .map((value) => {
      try {
        return new URL(value).origin
      } catch {
        return null
      }
    })
    .filter((value): value is string => Boolean(value))
}

/**
 * Throws unless the request demonstrably came from one of our own pages.
 *
 * The request's own Host is deliberately NOT trusted as an allowed origin: with
 * a misconfigured proxy an attacker controls the Host header, and comparing
 * Origin against it would then always agree.
 */
export function assertSameOrigin(request: Request): void {
  const permitted = allowedOrigins()
  const origin = request.headers.get('origin')
  const referer = request.headers.get('referer')

  const reject = (reason: string): never => {
    // The client sees a bare 403. Everything needed to explain it is here:
    // what the browser sent, and what the deployment was told to expect. None
    // of it is secret — an origin is a public name — and without it a
    // misconfigured SIGN_PUBLIC_URL looks exactly like an attack.
    log.warn('csrf_check_failed', {
      reason,
      origin,
      referer: referer ? safeOrigin(referer) : null,
      allowedOrigins: permitted,
      path: new URL(request.url).pathname,
    })
    throw new CsrfError(reason)
  }

  if (permitted.length === 0) {
    // Failing closed: an unconfigured deployment must not silently accept
    // cross-site mutations.
    reject('no_allowed_origins_configured')
  }

  if (origin) {
    if (!permitted.includes(origin)) reject('origin_mismatch')
    return
  }

  if (referer) {
    const refererOrigin = safeOrigin(referer)
    if (!refererOrigin) reject('referer_unparseable')
    else if (!permitted.includes(refererOrigin)) reject('referer_mismatch')
    return
  }

  reject('origin_and_referer_absent')
}

/** The origin of a URL, or null when it does not parse. Never the path. */
function safeOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}
