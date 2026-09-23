import { NextRequest } from 'next/server'
import { describe, expect, it } from 'vitest'
import { proxy } from '../proxy'

/**
 * The campaign's own domain serves the campaign and what its pages load,
 * and nothing else. The XTRA wordmark the joining page's header shows lives
 * at the site root, so it must be on the list — or the header shows a broken
 * picture on tourism.xtra.co.il and a fine one everywhere else.
 */
const on = (host: string, path: string) => proxy(new NextRequest(`https://${host}${path}`, { headers: { host } }))
const passes = (r: Response) => r.headers.get('x-middleware-next') === '1'

describe('the campaign host', () => {
  it('serves the campaign, its assets and the wordmark', () => {
    for (const path of ['/tourism-2026', '/tourism-2026/join', '/tourism-2026/hotel/hero.webp', '/xtra-logo.png', '/_next/static/x.js', '/api/self-service/abc/register']) {
      expect(passes(on('tourism.xtra.co.il', path)), path).toBe(true)
    }
  })

  it('answers 404 for everything else', () => {
    for (const path of ['/login', '/projects', '/api/projects/x', '/other-logo.png', '/xtra-logo.png.bak']) {
      expect(on('tourism.xtra.co.il', path).status, path).toBe(404)
    }
  })

  it('sends the root to the campaign, and leaves other hosts alone', () => {
    const root = on('tourism.xtra.co.il', '/')
    expect(root.status).toBe(307)
    expect(root.headers.get('location')).toBe('https://tourism.xtra.co.il/tourism-2026')
    expect(passes(on('xtra-sign.vercel.app', '/login'))).toBe(true)
  })
})
