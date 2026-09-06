import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { publicBaseUrl } from '../public-url'
import { allowedOrigins } from '../csrf'

/**
 * One base URL for every link we put in a message and every origin we accept
 * a mutation from. On a Vercel preview there is no SIGN_PUBLIC_URL, and the
 * deployment's own address is the only right answer.
 */

const saved = { ...process.env }

beforeEach(() => {
  delete process.env.SIGN_PUBLIC_URL
  delete process.env.SIGN_EXTRA_ORIGINS
  delete process.env.VERCEL_ENV
  delete process.env.VERCEL_URL
  delete process.env.VERCEL_BRANCH_URL
})

afterEach(() => {
  process.env = { ...saved }
})

describe('publicBaseUrl', () => {
  it('prefers the configured public URL, without a trailing slash', () => {
    process.env.SIGN_PUBLIC_URL = 'https://xtra-sign.vercel.app/'
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_BRANCH_URL = 'xtra-sign-git-feat.vercel.app'
    expect(publicBaseUrl()).toBe('https://xtra-sign.vercel.app')
  })

  it('falls back to the branch address on a preview deployment', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_BRANCH_URL = 'xtra-sign-git-feat.vercel.app'
    process.env.VERCEL_URL = 'xtra-sign-abc123.vercel.app'
    expect(publicBaseUrl()).toBe('https://xtra-sign-git-feat.vercel.app')
  })

  it('never guesses a production address from Vercel variables', () => {
    process.env.VERCEL_ENV = 'production'
    process.env.VERCEL_URL = 'xtra-sign-abc123.vercel.app'
    expect(publicBaseUrl()).toBe('http://localhost:3000')
  })
})

describe('allowedOrigins on a preview', () => {
  it('trusts the branch and deployment origins only on a preview', () => {
    process.env.VERCEL_ENV = 'preview'
    process.env.VERCEL_BRANCH_URL = 'xtra-sign-git-feat.vercel.app'
    process.env.VERCEL_URL = 'xtra-sign-abc123.vercel.app'
    expect(allowedOrigins()).toEqual([
      'https://xtra-sign-git-feat.vercel.app',
      'https://xtra-sign-abc123.vercel.app',
    ])

    process.env.VERCEL_ENV = 'production'
    expect(allowedOrigins()).toEqual([])
  })
})
