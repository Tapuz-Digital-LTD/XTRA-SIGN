import { describe, expect, it } from 'vitest'
import { keyFromSegments } from '../key-path'

const ORG_ID = '11111111-1111-4111-8111-111111111111'
const PREFIX = `org/${ORG_ID}/`
const own = (...rest: string[]) => ['org', ORG_ID, ...rest]

describe('keyFromSegments', () => {
  it('accepts a key inside the caller organization', () => {
    expect(keyFromSegments(own('agreements', 'a1', 'source', 'f.pdf'), PREFIX)).toBe(
      `${PREFIX}agreements/a1/source/f.pdf`,
    )
  })

  it('refuses a key belonging to another organization', () => {
    expect(keyFromSegments(['org', 'other-org', 'f.pdf'], PREFIX)).toBeNull()
  })

  it('refuses traversal that would pass a prefix check', () => {
    // `org/<mine>/../other-org/f.pdf` starts with the caller's prefix, so a
    // `startsWith` on its own lets it through — and the write lands under a
    // different tenant. This asserts the naive check really is fooled, so the
    // test still means something if someone simplifies the guard away.
    const segments = own('..', 'other-org', 'f.pdf')
    expect(segments.join('/').startsWith(PREFIX)).toBe(true)
    expect(keyFromSegments(segments, PREFIX)).toBeNull()
  })

  it('refuses a separator smuggled inside one segment', () => {
    expect(keyFromSegments(own('a/../../b'), PREFIX)).toBeNull()
    expect(keyFromSegments(own('a\\..\\b'), PREFIX)).toBeNull()
  })

  it('refuses control characters and empty segments', () => {
    expect(keyFromSegments(own('a\u0000.pdf'), PREFIX)).toBeNull()
    expect(keyFromSegments(own(''), PREFIX)).toBeNull()
    expect(keyFromSegments([], PREFIX)).toBeNull()
  })

  it('does not decode: an encoded dot-dot stays an ordinary name', () => {
    // The router already decoded once. Decoding again here is exactly what
    // turns `%252e%252e` into `..` after a check has already passed.
    expect(keyFromSegments(own('%2e%2e'), PREFIX)).toBe(`${PREFIX}%2e%2e`)
  })
})
