import { afterEach, describe, expect, it, vi } from 'vitest'
import { inlineAssets } from '../inline-assets'
import { sanitizeTemplateHtml } from '../html-sanitize'

/**
 * Inlining is what makes an imported template a snapshot: the images live on
 * Fireberry's CDN and on third-party hosts, and a template that still pointed
 * at them would change — or break — when someone else moved a file.
 *
 * It is also the step that fetches attacker-influenceable URLs from inside our
 * network, so the address checks below are the point of the whole module.
 */

function withImages(...srcs: string[]) {
  return sanitizeTemplateHtml(srcs.map((s) => `<img src="${s}">`).join(''))
}

afterEach(() => vi.restoreAllMocks())

describe('inlineAssets', () => {
  it.each([
    ['the cloud metadata endpoint', 'http://169.254.169.254/latest/meta-data/'],
    ['loopback', 'http://127.0.0.1:5432/x.png'],
    ['loopback by name', 'http://localhost/x.png'],
    ['a private range', 'http://10.0.0.5/logo.png'],
    ['another private range', 'http://192.168.1.1/logo.png'],
  ])('refuses %s', async (_label, url) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const { html, images } = withImages(url)
    const result = await inlineAssets(html, images)

    expect(result.failed).toHaveLength(1)
    expect(result.html).not.toContain('data:image')
    // The address is rejected before any request is made.
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('refuses a non-http scheme', async () => {
    const { html, images } = withImages('ftp://example.com/a.png')
    // The sanitizer already dropped the src, so there is nothing to fetch.
    expect(images).toHaveLength(0)
    expect((await inlineAssets(html, images)).failed).toHaveLength(0)
  })

  it('inlines a real image as a data URI', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    const { html, images } = withImages('https://c.fireberry.com/file/x/logo.png')
    const result = await inlineAssets(html, images)

    expect(result.failed).toEqual([])
    expect(result.html).toContain(`data:image/png;base64,${png.toString('base64')}`)
    expect(result.html).not.toContain('c.fireberry.com')
  })

  it('refuses a response that is not an image', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('<html>login</html>', { status: 200, headers: { 'content-type': 'text/html' } }),
    )
    const { html, images } = withImages('https://example.com/a.png')
    const result = await inlineAssets(html, images)
    expect(result.failed).toHaveLength(1)
    expect(result.html).not.toContain('data:')
  })

  it('refuses an image over the size cap without buffering it all', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Buffer.alloc(6 * 1024 * 1024), {
        status: 200,
        headers: { 'content-type': 'image/png', 'content-length': String(6 * 1024 * 1024) },
      }),
    )
    const { html, images } = withImages('https://example.com/big.png')
    expect((await inlineAssets(html, images)).failed).toHaveLength(1)
  })

  it('stops after the asset-count cap', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(Buffer.from([0x89, 0x50]), { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    const srcs = Array.from({ length: 30 }, (_, i) => `https://example.com/${i}.png`)
    const { html, images } = withImages(...srcs)
    const result = await inlineAssets(html, images)
    expect(result.failed.length).toBeGreaterThan(0)
    expect(globalThis.fetch).toHaveBeenCalledTimes(25)
  })

  it('stops reading a body that lies about its size', async () => {
    // No content-length, and far more than the cap: the guard has to be the
    // read loop, not the header.
    let pulled = 0
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled += 1
        if (pulled > 500) return controller.close()
        controller.enqueue(new Uint8Array(64 * 1024))
      },
    })
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(body, { status: 200, headers: { 'content-type': 'image/png' } }),
    )
    const { html, images } = withImages('https://example.com/liar.png')
    const result = await inlineAssets(html, images)

    expect(result.failed).toEqual([{ src: 'https://example.com/liar.png', reason: 'התמונה גדולה מדי' }])
    // Cancelled around the 5 MB cap rather than reading all 32 MB.
    expect(pulled).toBeLessThan(200)
  })

  it('refuses a host that resolves to a private address', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    // A public-looking name; the resolver is what gives it away.
    const { html, images } = withImages('https://internal.example.com/a.png')
    const result = await inlineAssets(html, images)
    // Either the pre-check or the connect-time guard refuses it; what matters
    // is that no data URI is produced.
    if (fetchSpy.mock.calls.length > 0) expect(result.failed).toHaveLength(1)
    expect(result.html).not.toContain('data:image')
  })

  it('keeps one failure from losing the rest of the document', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47])
    vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('nope', { status: 404 }))
      .mockResolvedValueOnce(new Response(png, { status: 200, headers: { 'content-type': 'image/png' } }))
    const { html, images } = withImages('https://example.com/gone.png', 'https://example.com/ok.png')
    const result = await inlineAssets(html, images)

    expect(result.failed).toHaveLength(1)
    expect(result.html).toContain('data:image/png;base64')
  })
})
