import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CsrfError, allowedOrigins, assertSameOrigin } from '../csrf'

const APP = 'https://sign.xtra.co.il'

function req(headers: Record<string, string>, url = `${APP}/api/documents/upload`) {
  return new Request(url, { method: 'POST', headers })
}

beforeEach(() => {
  process.env.SIGN_PUBLIC_URL = APP
  delete process.env.SIGN_EXTRA_ORIGINS
})

afterEach(() => {
  delete process.env.SIGN_EXTRA_ORIGINS
})

describe('allowedOrigins', () => {
  it('normalises configured values to origins', () => {
    process.env.SIGN_EXTRA_ORIGINS = 'https://admin.xtra.co.il/some/path'
    expect(allowedOrigins()).toEqual([APP, 'https://admin.xtra.co.il'])
  })

  it('drops unparseable entries rather than trusting them', () => {
    process.env.SIGN_EXTRA_ORIGINS = 'not a url'
    expect(allowedOrigins()).toEqual([APP])
  })
})

describe('assertSameOrigin', () => {
  it('accepts a request from our own origin', () => {
    expect(() => assertSameOrigin(req({ origin: APP }))).not.toThrow()
  })

  it('REFUSES a cross-site origin', () => {
    expect(() => assertSameOrigin(req({ origin: 'https://evil.example' }))).toThrow(CsrfError)
  })

  it('REFUSES a sibling subdomain', () => {
    // The gap SameSite=Lax leaves wide open: a sibling subdomain is "same-site",
    // so Lax would let this through and only the Origin check stops it.
    expect(() => assertSameOrigin(req({ origin: 'https://blog.xtra.co.il' }))).toThrow(CsrfError)
  })

  it('refuses a look-alike host that merely starts the same', () => {
    expect(() =>
      assertSameOrigin(req({ origin: 'https://sign.xtra.co.il.evil.example' })),
    ).toThrow(CsrfError)
  })

  it('refuses the same host over a different scheme', () => {
    expect(() => assertSameOrigin(req({ origin: 'http://sign.xtra.co.il' }))).toThrow(CsrfError)
  })

  it('falls back to Referer when Origin is absent', () => {
    expect(() => assertSameOrigin(req({ referer: `${APP}/documents/new` }))).not.toThrow()
    expect(() => assertSameOrigin(req({ referer: 'https://evil.example/x' }))).toThrow(CsrfError)
  })

  it('REFUSES a request carrying neither header', () => {
    // For a mutation, "cannot tell where this came from" is a rejection.
    expect(() => assertSameOrigin(req({}))).toThrow(CsrfError)
  })

  it('does not trust the request Host as an allowed origin', () => {
    // With a misconfigured proxy the attacker controls Host; comparing Origin
    // against it would always agree.
    process.env.SIGN_PUBLIC_URL = APP
    const spoofed = new Request('https://evil.example/api/documents/upload', {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
    })
    expect(() => assertSameOrigin(spoofed)).toThrow(CsrfError)
  })

  it('fails closed when nothing is configured', () => {
    delete process.env.SIGN_PUBLIC_URL
    expect(() => assertSameOrigin(req({ origin: APP }))).toThrow(CsrfError)
  })
})
