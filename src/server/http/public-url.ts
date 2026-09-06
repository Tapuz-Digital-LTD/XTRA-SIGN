/**
 * The address the outside world reaches this deployment at.
 *
 * One function, because it feeds two things that must agree: every link put
 * in an SMS or an email, and the list of origins a mutation is accepted from.
 * Production sets SIGN_PUBLIC_URL. A Vercel preview has no such value and
 * answers at a branch address the platform mints — so that address is used
 * there, and only there: a production deployment must never derive its public
 * name from a deployment-specific variable.
 */

export function publicBaseUrl(): string {
  const configured = process.env.SIGN_PUBLIC_URL?.trim()
  if (configured) return configured.replace(/\/+$/, '')
  return previewOrigins()[0] ?? 'http://localhost:3000'
}

/**
 * The origins a preview deployment answers at: the stable branch alias first
 * (the one a link should carry, since it survives redeploys), then the
 * per-deployment address (the one a browser may actually be on).
 */
export function previewOrigins(): string[] {
  if (process.env.VERCEL_ENV !== 'preview') return []
  const hosts = [process.env.VERCEL_BRANCH_URL, process.env.VERCEL_URL]
    .map((host) => host?.trim())
    .filter((host): host is string => Boolean(host))
  return [...new Set(hosts.map((host) => `https://${host}`))]
}
