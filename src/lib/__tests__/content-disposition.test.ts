import { describe, expect, it } from 'vitest'
import { attachmentFilename } from '../content-disposition'

describe('attachmentFilename', () => {
  it('produces a header value that is latin1-safe', () => {
    const value = attachmentFilename('xtra-sign-ספקים.xlsx')
    // The whole point: this is what threw in production.
    expect(() => new Headers({ 'Content-Disposition': value })).not.toThrow()
    expect([...value].every((c) => c.charCodeAt(0) <= 255)).toBe(true)
  })

  it('keeps the real name available to browsers that can read it', () => {
    expect(attachmentFilename('דוח.xlsx')).toContain(`filename*=UTF-8''${encodeURIComponent('דוח.xlsx')}`)
  })

  it('leaves an ascii name alone', () => {
    expect(attachmentFilename('report.xlsx')).toContain('filename="report.xlsx"')
  })
})
