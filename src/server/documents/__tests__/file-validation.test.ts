import { describe, expect, it } from 'vitest'
import {
  MAX_FILE_BYTES,
  buildStorageKey,
  sanitizeDisplayName,
  sha256,
  validateUpload,
} from '../file-validation'

/** Real leading bytes, not fixtures that merely claim a type. */
const PDF = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from('body')])
const DOCX = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from('zip')])
const DOC = Buffer.concat([
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
  Buffer.from('ole'),
])

describe('validateUpload', () => {
  it('accepts the three real document types by their leading bytes', () => {
    expect(validateUpload(PDF)).toMatchObject({ ok: true, kind: 'pdf', ext: 'pdf' })
    expect(validateUpload(DOCX)).toMatchObject({ ok: true, kind: 'docx', ext: 'docx' })
    expect(validateUpload(DOC)).toMatchObject({ ok: true, kind: 'doc', ext: 'doc' })
  })

  it('rejects HTML that would pass any extension or MIME check', () => {
    // The exact attack: contract.pdf, Content-Type application/pdf, and a body
    // that runs script the moment something renders it inline.
    const html = Buffer.from('<html><script>alert(document.cookie)</script></html>')
    const result = validateUpload(html)
    expect(result.ok).toBe(false)
    expect(result.ok === false && result.code).toBe('unsupported_type')
  })

  it('rejects a file whose bytes only nearly match a signature', () => {
    expect(validateUpload(Buffer.from('%PDF')).ok).toBe(false) // missing the '-'
    expect(validateUpload(Buffer.from([0x50, 0x4b, 0x03])).ok).toBe(false)
  })

  it('rejects empty and oversized files', () => {
    expect(validateUpload(Buffer.alloc(0))).toMatchObject({ ok: false, code: 'empty' })

    const huge = Buffer.concat([PDF, Buffer.alloc(MAX_FILE_BYTES + 1)])
    expect(validateUpload(huge)).toMatchObject({ ok: false, code: 'too_large' })
  })

  it('reports errors in Hebrew without echoing file content back', () => {
    const result = validateUpload(Buffer.from('<script>x</script>'))
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.message).toMatch(/[\u0590-\u05ff]/)
      expect(result.message).not.toContain('script')
    }
  })
})

describe('sha256', () => {
  it('matches the known digest of a known input', () => {
    // Independently verifiable: echo -n "abc" | shasum -a 256
    expect(sha256(Buffer.from('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
  })

  it('changes when a single byte changes', () => {
    const a = sha256(Buffer.concat([PDF, Buffer.from('x')]))
    const b = sha256(Buffer.concat([PDF, Buffer.from('y')]))
    expect(a).not.toBe(b)
  })
})

describe('buildStorageKey', () => {
  const base = {
    organizationId: '11111111-1111-4111-8111-111111111111',
    agreementId: '22222222-2222-4222-8222-222222222222',
    purpose: 'source' as const,
  }

  it('puts the organization first so a prefix listing cannot span tenants', () => {
    expect(buildStorageKey({ ...base, ext: 'pdf' }).startsWith(`org/${base.organizationId}/`)).toBe(
      true,
    )
  })

  it('never derives the key from a filename, so traversal cannot reach it', () => {
    const key = buildStorageKey({ ...base, ext: '../../../etc/passwd' })
    expect(key).not.toContain('..')
    expect(key.endsWith('.bin')).toBe(true)
  })

  it('is unique per call', () => {
    const a = buildStorageKey({ ...base, ext: 'pdf' })
    const b = buildStorageKey({ ...base, ext: 'pdf' })
    expect(a).not.toBe(b)
  })
})

describe('sanitizeDisplayName', () => {
  it('keeps Hebrew names intact and drops the extension', () => {
    // The title is a document name in a list, not a filename — keeping the
    // extension produced "הסכם ספק.pdf.pdf" on download.
    expect(sanitizeDisplayName('הסכם ספק.pdf')).toBe('הסכם ספק')
    expect(sanitizeDisplayName('Supplier Agreement.docx')).toBe('Supplier Agreement')
  })

  it('strips directory components and control characters', () => {
    expect(sanitizeDisplayName('../../etc/passwd')).toBe('passwd')
    expect(sanitizeDisplayName('a\u0000b\nc')).toBe('abc')
  })

  it('never returns an empty label', () => {
    expect(sanitizeDisplayName('')).toBe('מסמך')
    expect(sanitizeDisplayName('///')).toBe('מסמך')
  })
})
