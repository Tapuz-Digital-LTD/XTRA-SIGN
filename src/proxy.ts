import { NextResponse, type NextRequest } from 'next/server'

/**
 * Host-based restriction for the campaign's own domain.
 *
 * tourism.xtra.co.il is a public landing address for one campaign and
 * nothing else: its root sends visitors to the campaign page, and only the
 * campaign's pages, the assets they load and the few API routes the
 * registration and signing flow call are reachable through it. Login, the
 * staff screens and every other API answer 404 on that host. The default
 * domain (xtra-sign.vercel.app) and any other host are not touched.
 */

const CAMPAIGN_HOSTS: Record<string, string> = {
  'tourism.xtra.co.il': '/tourism-2026',
}

/** What a campaign host may serve, beyond its own campaign paths. */
const SHARED_ALLOW = [
  /^\/_next\//, // scripts, styles, fonts, images
  /^\/favicon\.ico/,
  /^\/api\/self-service\//, // registration + page events
  /^\/api\/sign\//, // OTP, signature, signed file, secure download
  /^\/api\/public\//, // share images
  /^\/sign\//, // a signing link from an SMS hands over to the campaign
]

export function proxy(request: NextRequest) {
  const host = (request.headers.get('host') ?? '').toLowerCase().split(':')[0]
  const campaignPath = CAMPAIGN_HOSTS[host]
  if (!campaignPath) return NextResponse.next()

  const { pathname } = request.nextUrl
  if (pathname === '/') {
    const url = request.nextUrl.clone()
    url.pathname = campaignPath
    return NextResponse.redirect(url, 307)
  }
  const allowed =
    pathname === campaignPath ||
    pathname.startsWith(`${campaignPath}/`) ||
    SHARED_ALLOW.some((re) => re.test(pathname))
  if (allowed) return NextResponse.next()
  return new NextResponse('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' } })
}

export const config = {
  // Everything but Next's own static output; the function returns at once for other hosts.
  matcher: ['/((?!_next/static|_next/image).*)'],
}
